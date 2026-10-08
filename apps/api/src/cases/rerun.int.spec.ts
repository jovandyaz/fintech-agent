import type { CaseStatus } from '@fintech-agent/contracts';
import type { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ANA,
  HTTP,
  NO_CORE,
  seedProposal,
  startApiApp,
} from '../../test/api-app.js';
import {
  CONTAINER_START_MS,
  startTestDatabase,
  type TestDatabase,
} from '../../test/database.js';

const FINAL = 'Hola Ana, ya revisamos tu caso.';
const RACES = 10;

let db: TestDatabase;
let owner: postgres.Sql;
let app: INestApplication;
let base: string;
let sequence = 0;

const rerun = (caseId: string, token: string | null = ANA) =>
  fetch(`${base}/cases/${caseId}/rerun`, {
    method: 'POST',
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  });

const decide = (actionId: string) =>
  fetch(`${base}/actions/${actionId}/decision`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${ANA}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      decision: 'reject',
      final_reply: FINAL,
      acknowledged_flags: [],
      reject_code: 'tone',
    }),
  });

const approve = (actionId: string) =>
  fetch(`${base}/actions/${actionId}/decision`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${ANA}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      decision: 'approve',
      final_reply: FINAL,
      acknowledged_flags: [],
      reviewed_transaction_ids: [],
    }),
  });

async function seeded(caseStatus: CaseStatus = 'needs_review', canary = false) {
  sequence += 1;
  const proposal = await seedProposal(owner, `r${sequence}`, {
    caseStatus,
    canary,
  });
  if (canary) {
    await owner`insert into canary_cases (case_id, defect) values (${proposal.caseId}, 'cold_tone')`;
  }
  return proposal;
}

const proposalsOf = (caseId: string) =>
  owner<{ id: string; status: string; is_canary: boolean; type: string }[]>`
    select id, status, is_canary, type from proposed_actions
    where case_id = ${caseId} order by proposed_at, id`;

async function state(caseId: string, actionId: string) {
  const [row] = await owner<
    { case_status: string; manual_reruns: number; action_status: string }[]
  >`
    select c.status as case_status, c.manual_reruns, a.status as action_status
    from cases c join proposed_actions a on a.case_id = c.id
    where c.id = ${caseId} and a.id = ${actionId}`;
  return row;
}

beforeAll(async () => {
  db = await startTestDatabase();
  owner = postgres(db.ownerUrl, { max: 1, onnotice: () => undefined });
  ({ app, base } = await startApiApp(db, NO_CORE));
}, CONTAINER_START_MS);

afterAll(async () => {
  await app?.close();
  await owner?.end();
  await db?.stop();
});

describe('manual re-runs (02 G3)', () => {
  it.each(['needs_review', 'failed'] as const)(
    'moves a %s case to queued and supersedes its open proposal',
    async (status) => {
      const { caseId, actionId } = await seeded(status);
      const response = await rerun(caseId);
      expect(response.status).toBe(HTTP.ok);
      expect(await response.json()).toEqual({
        case_id: caseId,
        status: 'queued',
        manual_reruns: 1,
      });
      expect(await state(caseId, actionId)).toEqual({
        case_status: 'queued',
        manual_reruns: 1,
        action_status: 'superseded',
      });
      const [audit] = await owner<
        { actor: string; event: string; key_id: string }[]
      >`
        select actor, event, key_id from audit_log where ref = ${caseId}`;
      expect(audit).toEqual({
        actor: 'operator:ana',
        event: 'case.rerun',
        key_id: 'k1',
      });
    },
  );

  it('re-runs a resolved case and leaves its decided proposal untouched', async () => {
    const { caseId, actionId } = await seeded();
    expect((await decide(actionId)).status).toBe(HTTP.ok);
    expect((await rerun(caseId)).status).toBe(HTTP.ok);
    expect(await state(caseId, actionId)).toEqual({
      case_status: 'queued',
      manual_reruns: 1,
      action_status: 'rejected',
    });
  });

  it('answers 409 to a decision on a superseded proposal', async () => {
    const { caseId, actionId } = await seeded();
    expect((await rerun(caseId)).status).toBe(HTTP.ok);
    expect((await decide(actionId)).status).toBe(HTTP.conflict);
  });

  it('refuses the fourth re-run', async () => {
    const { caseId } = await seeded();
    for (let i = 0; i < 3; i += 1) {
      await owner`update cases set status = 'needs_review' where id = ${caseId}`;
      expect((await rerun(caseId)).status).toBe(HTTP.ok);
    }
    await owner`update cases set status = 'needs_review' where id = ${caseId}`;
    expect((await rerun(caseId)).status).toBe(HTTP.conflict);
  });

  it.each(['queued', 'investigating'] as const)(
    'refuses a %s case',
    async (status) => {
      const { caseId, actionId } = await seeded(status);
      expect((await rerun(caseId)).status).toBe(HTTP.conflict);
      expect((await state(caseId, actionId))?.action_status).toBe('proposed');
    },
  );

  it('lets only one of two concurrent re-runs through', async () => {
    const { caseId } = await seeded();
    const statuses = await Promise.all([rerun(caseId), rerun(caseId)]).then(
      (responses) => responses.map(({ status }) => status).sort(),
    );
    expect(statuses).toEqual([HTTP.ok, HTTP.conflict]);
  });

  it('answers 400 for a case id outside the registry format', async () => {
    expect((await rerun('Case-X1')).status).toBe(HTTP.badRequest);
  });

  it('answers 404 for an unknown case and 401 without a token', async () => {
    expect((await rerun('case_nope')).status).toBe(HTTP.notFound);
    const { caseId } = await seeded();
    expect((await rerun(caseId, null)).status).toBe(HTTP.unauthorized);
  });

  it('audits the superseded proposal, not only the case', async () => {
    const { caseId, actionId } = await seeded();
    expect((await rerun(caseId)).status).toBe(HTTP.ok);
    const rows = await owner<{ ref: string; event: string; actor: string }[]>`
      select ref, event, actor from audit_log where ref in (${caseId}, ${actionId}) order by event`;
    expect(rows).toEqual([
      { ref: caseId, event: 'case.rerun', actor: 'operator:ana' },
      { ref: actionId, event: 'proposal.supersede', actor: 'operator:ana' },
    ]);
  });

  it('never answers 500 and never ends inconsistent when a re-run races a decision', async () => {
    for (let i = 0; i < RACES; i += 1) {
      const { caseId, actionId } = await seeded();
      const [rerunStatus, decideStatus] = await Promise.all([
        rerun(caseId),
        decide(actionId),
      ]).then((responses) => responses.map(({ status }) => status));
      const end = await state(caseId, actionId);
      // Decision first: the resolved case may still be re-run. Re-run first:
      // the proposal is superseded and the decision is a conflict.
      if (decideStatus === HTTP.ok) {
        expect(rerunStatus).toBe(HTTP.ok);
        expect(end).toMatchObject({
          case_status: 'queued',
          action_status: 'rejected',
        });
      } else {
        expect([rerunStatus, decideStatus]).toEqual([HTTP.ok, HTTP.conflict]);
        expect(end).toMatchObject({
          case_status: 'queued',
          action_status: 'superseded',
        });
      }
    }
  });
});

describe('re-runs of a canary case (02 G3)', () => {
  it('queues a canary case again like any re-run, for the worker to replay its script', async () => {
    const { caseId, actionId } = await seeded('needs_review', true);
    const response = await rerun(caseId);
    expect(response.status).toBe(HTTP.ok);
    expect(await response.json()).toEqual({
      case_id: caseId,
      status: 'queued',
      manual_reruns: 1,
    });
    const [row] = await owner<
      { status: string; attempts: number; claim_token: string | null }[]
    >`select status, attempts, claim_token from cases where id = ${caseId}`;
    expect(row).toEqual({ status: 'queued', attempts: 0, claim_token: null });
    expect(await proposalsOf(caseId)).toEqual([
      expect.objectContaining({ id: actionId, status: 'superseded' }),
    ]);
  });

  it('audits a canary re-run exactly as a real one', async () => {
    const real = await seeded('needs_review', false);
    const canary = await seeded('needs_review', true);
    expect((await rerun(real.caseId)).status).toBe(HTTP.ok);
    expect((await rerun(canary.caseId)).status).toBe(HTTP.ok);
    const eventsOf = (caseId: string, actionId: string) =>
      owner<{ event: string; detail_masked: unknown }[]>`
        select event, detail_masked from audit_log
        where ref in (${caseId}, ${actionId}) order by event`;
    expect(await eventsOf(canary.caseId, canary.actionId)).toEqual(
      await eventsOf(real.caseId, real.actionId),
    );
  });

  it('re-runs a failed canary case whose canary was only superseded, as a real one', async () => {
    const { caseId } = await seeded('needs_review', true);
    expect((await rerun(caseId)).status).toBe(HTTP.ok);
    await owner`update cases set status = 'failed' where id = ${caseId}`;
    const again = await rerun(caseId);
    expect(again.status).toBe(HTTP.ok);
    expect(await again.json()).toMatchObject({ status: 'queued' });
  });

  it('refuses to re-run a canary that has no marker, which the worker would never claim', async () => {
    sequence += 1;
    const { caseId } = await seedProposal(owner, `r${sequence}`, {
      canary: true,
    });
    expect((await rerun(caseId)).status).toBe(HTTP.conflict);
  });

  it('refuses to re-run a canary the operator approved', async () => {
    const { caseId, actionId } = await seeded('needs_review', true);
    expect((await approve(actionId)).status).toBe(HTTP.ok);
    expect((await proposalsOf(caseId))[0]?.status).toBe('canary_missed');
    expect((await rerun(caseId)).status).toBe(HTTP.conflict);
  });

  it('refuses to re-run a canary that was already decided', async () => {
    const { caseId, actionId } = await seeded('needs_review', true);
    expect((await decide(actionId)).status).toBe(HTTP.ok);
    expect((await rerun(caseId)).status).toBe(HTTP.conflict);
    expect(
      (await proposalsOf(caseId)).every(({ is_canary }) => is_canary),
    ).toBe(true);
  });
});
