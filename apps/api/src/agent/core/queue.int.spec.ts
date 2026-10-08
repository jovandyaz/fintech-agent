import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { seedProposal } from '../../../test/api-app.js';
import {
  CONTAINER_START_MS,
  insertCase,
  startTestDatabase,
  type TestDatabase,
} from '../../../test/database.js';
import type { Database, DbTransaction } from '../../database/index.js';
import * as schema from '../../database/schema.js';
import {
  LEASE_EXPIRED,
  MAX_ATTEMPTS,
  StaleClaimError,
  claimCase,
  claimNextCase,
  failLeftoverEvalCases,
  releaseForRetry,
  withClaim,
  type Claim,
} from './queue.js';

const RUN_TIMEOUT_MS = 180_000;
const LEASE_MS = RUN_TIMEOUT_MS + 30_000;
const RACES = 10;
const MIDDLE = () => 0.5;
const T0 = new Date('2026-10-07T15:00:00Z');
const later = (ms: number): Date => new Date(T0.getTime() + ms);
const CHECK_VIOLATION = '23514';

let testDb: TestDatabase;
let owner: postgres.Sql;
let apiSql: postgres.Sql;
let db: Database;
let sequence = 0;

const nextId = (): string => `case_q${++sequence}`;

async function queued(dueAt: Date = T0): Promise<string> {
  const id = nextId();
  await insertCase(owner, id);
  await owner`update cases set next_attempt_at = ${dueAt} where id = ${id}`;
  return id;
}

async function queuedEval(dueAt: Date = T0): Promise<string> {
  const id = await queued(dueAt);
  await owner`update cases set source = 'eval' where id = ${id}`;
  return id;
}

const claimAt = (now: Date) =>
  claimNextCase(db, { now, runTimeoutMs: RUN_TIMEOUT_MS });

const retry = (claim: Claim, now: Date = T0) =>
  withClaim(db, claim, (tx) =>
    releaseForRetry(tx, claim, { now, random: MIDDLE }),
  );

async function insertRun(caseId: string, runId: string, status = 'running') {
  await owner`
    insert into agent_runs (id, case_id, variant, model, prompt_version, status)
    values (${runId}, ${caseId}, 'A', 'claude-sonnet-5-5', 'p1', ${status})`;
}

const insertRunIn = (caseId: string, runId: string) => (tx: DbTransaction) =>
  tx.insert(schema.agentRuns).values({
    id: runId,
    caseId,
    variant: 'A',
    model: 'claude-sonnet-5-5',
    promptVersion: 'p1',
  });

const runRow = async (id: string) => {
  const [row] = await owner`
    select status, error_code from agent_runs where id = ${id}`;
  return row!;
};

const caseRow = async (id: string) => {
  const [row] = await owner`
    select status, attempts, claim_token, locked_until, next_attempt_at
    from cases where id = ${id}`;
  return row!;
};

beforeAll(async () => {
  testDb = await startTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 2 });
  apiSql = postgres(testDb.urlFor('copilot_api'), { max: RACES });
  db = drizzle({ client: apiSql, schema });
}, CONTAINER_START_MS);

afterAll(async () => {
  await apiSql?.end();
  await owner?.end();
  await testDb?.stop();
});

beforeEach(async () => {
  await owner`
    update cases set status = 'resolved', claim_token = null, locked_until = null
    where status in ('queued', 'investigating')`;
});

describe('claimNextCase', () => {
  it('claims a due case as investigating, with a fresh token, the timeout plus 30 s of lease and one more attempt', async () => {
    const id = await queued();
    const claim = await claimAt(T0);
    expect(claim).toMatchObject({ caseId: id, attempt: 1 });
    const row = await caseRow(id);
    expect(row).toMatchObject({
      status: 'investigating',
      attempts: 1,
      claim_token: claim!.claimToken,
    });
    expect(row.locked_until).toEqual(later(LEASE_MS));
  });

  it('leaves a case that is not yet due', async () => {
    await queued(later(1000));
    expect(await claimAt(T0)).toBeNull();
  });

  it('hands one case to only one of many concurrent claims', async () => {
    const id = await queued();
    const claims = await Promise.all(
      Array.from({ length: RACES }, () => claimAt(T0)),
    );
    expect(claims.filter((claim) => claim !== null)).toEqual([
      expect.objectContaining({ caseId: id }),
    ]);
  });

  it('hands many due cases to as many concurrent claims, skipping locked rows', async () => {
    const ids = await Promise.all(
      Array.from({ length: RACES }, () => queued()),
    );
    const claims = await Promise.all(
      Array.from({ length: RACES }, () => claimAt(T0)),
    );
    expect(claims.map((claim) => claim?.caseId).sort()).toEqual(ids.sort());
  });

  it('claims a canary case by its marker, as any case (02 G3)', async () => {
    const id = await queued();
    await owner`insert into canary_cases (case_id, defect) values (${id}, 'cold_tone')`;
    expect(await claimAt(T0)).toMatchObject({ caseId: id });
  });

  it('claims a re-run canary case again, its old canary superseded', async () => {
    const { caseId } = await seedProposal(owner, `qc${++sequence}`, {
      canary: true,
      caseStatus: 'queued',
    });
    await owner`alter table proposed_actions disable trigger enforce_transition_role`;
    await owner`update proposed_actions set status = 'superseded' where case_id = ${caseId}`;
    await owner`alter table proposed_actions enable trigger enforce_transition_role`;
    await owner`insert into canary_cases (case_id, defect) values (${caseId}, 'cold_tone')`;
    await owner`update cases set next_attempt_at = ${T0} where id = ${caseId}`;
    expect(await claimAt(T0)).toMatchObject({ caseId });
  });

  it('never claims a case holding a canary without its marker', async () => {
    const { caseId } = await seedProposal(owner, `qc${++sequence}`, {
      canary: true,
      caseStatus: 'queued',
    });
    await owner`update cases set next_attempt_at = ${T0} where id = ${caseId}`;
    expect(await claimAt(T0)).toBeNull();
  });

  it('reclaims an expired lease with a new token and abandons only the running run', async () => {
    const id = await queued();
    await insertRun(id, `run_done_${id}`, 'succeeded');
    const first = await claimAt(T0);
    await insertRun(id, `run_${id}`);
    expect(await claimAt(later(LEASE_MS - 1))).toBeNull();
    const second = await claimAt(later(LEASE_MS + 1));
    expect(second).toMatchObject({ caseId: id, attempt: 2 });
    expect(second!.claimToken).not.toBe(first!.claimToken);
    expect(await runRow(`run_${id}`)).toEqual({
      status: 'abandoned',
      error_code: LEASE_EXPIRED,
    });
    expect(await runRow(`run_done_${id}`)).toEqual({
      status: 'succeeded',
      error_code: null,
    });
  });

  it('fails a case whose last attempt lost its lease, abandons its run and claims the next due case', async () => {
    const lost = await queued();
    await owner`
      update cases set status = 'investigating', attempts = ${MAX_ATTEMPTS},
        claim_token = gen_random_uuid(), locked_until = ${T0}
      where id = ${lost}`;
    await insertRun(lost, `run_${lost}`);
    const next = await queued(later(1));
    expect(await claimAt(later(2))).toMatchObject({ caseId: next });
    expect(await caseRow(lost)).toMatchObject({
      status: 'failed',
      claim_token: null,
      locked_until: null,
    });
    expect(await runRow(`run_${lost}`)).toEqual({
      status: 'abandoned',
      error_code: LEASE_EXPIRED,
    });
  });

  it('never claims an eval case: the eval runner claims its own, by id (03 §Runner)', async () => {
    await queuedEval(later(-LEASE_MS));
    expect(await claimAt(T0)).toBeNull();
  });

  it('cannot leave a case investigating without a token and a lease', async () => {
    const id = await queued();
    await expect(
      owner`update cases set status = 'investigating' where id = ${id}`,
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });
});

describe('claimCase', () => {
  it('claims exactly the named queued case, whatever else is due first', async () => {
    await queued(later(-LEASE_MS));
    const id = await queuedEval();
    const claim = await claimCase(db, id, {
      now: T0,
      runTimeoutMs: RUN_TIMEOUT_MS,
    });
    expect(claim).toMatchObject({ caseId: id, attempt: 1 });
    const row = await caseRow(id);
    expect(row).toMatchObject({
      status: 'investigating',
      attempts: 1,
      claim_token: claim!.claimToken,
    });
    expect(row.locked_until).toEqual(later(LEASE_MS));
  });

  it('hands one eval case to only one of many concurrent claims', async () => {
    const id = await queuedEval();
    const options = { now: T0, runTimeoutMs: RUN_TIMEOUT_MS };
    const claims = await Promise.all(
      Array.from({ length: RACES }, () => claimCase(db, id, options)),
    );
    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
  });

  it('claims a case once: a second claim finds it investigating', async () => {
    const id = await queuedEval();
    const options = { now: T0, runTimeoutMs: RUN_TIMEOUT_MS };
    expect(await claimCase(db, id, options)).not.toBeNull();
    expect(await claimCase(db, id, options)).toBeNull();
  });

  it('claims only eval cases, never a webhook case the worker owns', async () => {
    const id = await queued();
    expect(
      await claimCase(db, id, { now: T0, runTimeoutMs: RUN_TIMEOUT_MS }),
    ).toBeNull();
  });

  it('never claims a case holding a canary without its marker (02 G3)', async () => {
    const { caseId } = await seedProposal(owner, `qe${++sequence}`, {
      canary: true,
      caseStatus: 'queued',
    });
    await owner`update cases set source = 'eval' where id = ${caseId}`;
    expect(
      await claimCase(db, caseId, { now: T0, runTimeoutMs: RUN_TIMEOUT_MS }),
    ).toBeNull();
  });

  it('claims nothing for a case that is not queued', async () => {
    const id = await queuedEval();
    await owner`update cases set status = 'resolved' where id = ${id}`;
    expect(
      await claimCase(db, id, { now: T0, runTimeoutMs: RUN_TIMEOUT_MS }),
    ).toBeNull();
  });
});

describe('failLeftoverEvalCases', () => {
  it('fails the eval cases an earlier runner left queued or holding a dead lease, and abandons their runs', async () => {
    const opened = await queuedEval();
    const dead = await queuedEval();
    await owner`
      update cases set status = 'investigating', attempts = 1,
        claim_token = gen_random_uuid(), locked_until = ${T0}
      where id = ${dead}`;
    await insertRun(dead, `run_${dead}`);
    expect((await failLeftoverEvalCases(db, later(1))).sort()).toEqual(
      [opened, dead].sort(),
    );
    for (const id of [opened, dead]) {
      expect(await caseRow(id)).toMatchObject({
        status: 'failed',
        claim_token: null,
        locked_until: null,
      });
    }
    expect(await runRow(`run_${dead}`)).toEqual({
      status: 'abandoned',
      error_code: LEASE_EXPIRED,
    });
  });

  it('leaves an eval case whose lease still runs, and every case the worker owns', async () => {
    const live = await queuedEval();
    await claimCase(db, live, { now: T0, runTimeoutMs: RUN_TIMEOUT_MS });
    const webhook = await queued();
    expect(await failLeftoverEvalCases(db, later(1))).toEqual([]);
    expect(await caseRow(live)).toMatchObject({ status: 'investigating' });
    expect(await caseRow(webhook)).toMatchObject({ status: 'queued' });
  });
});

describe('withClaim', () => {
  it('lets a stale claim write nothing once another worker holds the case', async () => {
    const id = await queued();
    const stale = await claimAt(T0);
    const current = await claimAt(later(LEASE_MS + 1));
    await expect(
      withClaim(db, stale!, insertRunIn(id, `run_stale_${id}`)),
    ).rejects.toBeInstanceOf(StaleClaimError);
    await withClaim(db, current!, insertRunIn(id, `run_current_${id}`));
    const runs = await owner`select id from agent_runs where case_id = ${id}`;
    expect(runs).toEqual([{ id: `run_current_${id}` }]);
  });

  it('refuses a claim whose case left investigating with the token still set', async () => {
    const id = await queued();
    const claim = await claimAt(T0);
    await owner`update cases set status = 'needs_review' where id = ${id}`;
    await expect(
      withClaim(db, claim!, () => Promise.resolve()),
    ).rejects.toBeInstanceOf(StaleClaimError);
  });

  it('keeps the case from being reclaimed while an attempt is writing', async () => {
    const id = await queued();
    const claim = await claimAt(T0);
    let finishWrite = () => {};
    let writing = () => {};
    const started = new Promise<void>((resolve) => (writing = resolve));
    const write = withClaim(db, claim!, async () => {
      writing();
      await new Promise<void>((resolve) => (finishWrite = resolve));
    });
    await started;
    expect(await claimAt(later(LEASE_MS + 1))).toBeNull();
    finishWrite();
    await write;
    expect(await caseRow(id)).toMatchObject({ claim_token: claim!.claimToken });
  });

  it('refuses a claim on a case that has moved on', async () => {
    const id = await queued();
    const claim = await claimAt(T0);
    await owner`
      update cases set status = 'needs_review', claim_token = null, locked_until = null
      where id = ${id}`;
    await expect(
      withClaim(db, claim!, () => Promise.resolve()),
    ).rejects.toBeInstanceOf(StaleClaimError);
  });
});

describe('releaseForRetry', () => {
  it('queues the case again after the backoff and frees the claim', async () => {
    const id = await queued();
    const claim = await claimAt(T0);
    expect(await retry(claim!)).toBe('queued');
    expect(await caseRow(id)).toMatchObject({
      status: 'queued',
      claim_token: null,
      locked_until: null,
      next_attempt_at: later(20_000),
    });
  });

  it('fails the case after its last attempt', async () => {
    const id = await queued();
    let outcome = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const now = later(attempt * LEASE_MS * 2);
      const claim = await claimAt(now);
      expect(claim).toMatchObject({ caseId: id, attempt });
      outcome = await retry(claim!, now);
    }
    expect(outcome).toBe('failed');
    expect(await caseRow(id)).toMatchObject({
      status: 'failed',
      attempts: MAX_ATTEMPTS,
      claim_token: null,
    });
  });

  it('commits with the run it closes, or not at all', async () => {
    const id = await queued();
    const claim = await claimAt(T0);
    await insertRun(id, `run_${id}`);
    const closeAndRetry = (fail: boolean) =>
      withClaim(db, claim!, async (tx) => {
        await tx
          .update(schema.agentRuns)
          .set({ status: 'failed', errorCode: 'provider_unavailable' })
          .where(eq(schema.agentRuns.id, `run_${id}`));
        await releaseForRetry(tx, claim!, { now: T0, random: MIDDLE });
        if (fail) throw new Error('crash before commit');
      });
    await expect(closeAndRetry(true)).rejects.toThrow('crash before commit');
    expect(await runRow(`run_${id}`)).toEqual({
      status: 'running',
      error_code: null,
    });
    expect(await caseRow(id)).toMatchObject({ status: 'investigating' });
    await closeAndRetry(false);
    expect(await runRow(`run_${id}`)).toEqual({
      status: 'failed',
      error_code: 'provider_unavailable',
    });
    expect(await caseRow(id)).toMatchObject({ status: 'queued' });
  });

  it('writes nothing for a stale claim', async () => {
    const id = await queued();
    const stale = await claimAt(T0);
    await claimAt(later(LEASE_MS + 1));
    await expect(retry(stale!)).rejects.toBeInstanceOf(StaleClaimError);
    expect(await caseRow(id)).toMatchObject({ status: 'investigating' });
  });
});
