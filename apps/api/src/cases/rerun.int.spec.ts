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

async function seeded(caseStatus: CaseStatus = 'needs_review', canary = false) {
  sequence += 1;
  return seedProposal(owner, `r${sequence}`, { caseStatus, canary });
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
  it('answers like a real re-run but never queues the case for the agent', async () => {
    const { caseId, actionId } = await seeded('needs_review', true);
    const response = await rerun(caseId);
    expect(response.status).toBe(HTTP.ok);
    expect(await response.json()).toEqual({
      case_id: caseId,
      status: 'queued',
      manual_reruns: 1,
    });
    const [row] = await owner<{ status: string }[]>`
      select status from cases where id = ${caseId}`;
    expect(row?.status).toBe('needs_review');
    const proposals = await proposalsOf(caseId);
    expect(proposals).toHaveLength(2);
    expect(proposals[0]).toMatchObject({ id: actionId, status: 'superseded' });
    expect(proposals[1]).toMatchObject({
      status: 'proposed',
      is_canary: true,
      type: 'open_dispute',
    });
  });

  it('gives the fresh canary copy the audit row a real proposal gets', async () => {
    const { caseId } = await seeded('needs_review', true);
    expect((await rerun(caseId)).status).toBe(HTTP.ok);
    const fresh = (await proposalsOf(caseId)).find(
      ({ status }) => status === 'proposed',
    );
    const [run] = await owner<{ run_id: string }[]>`
      select run_id from proposed_actions where id = ${fresh!.id}`;
    expect(
      await owner`
        select actor, event, detail_masked from audit_log where ref = ${fresh!.id}`,
    ).toEqual([
      {
        actor: 'agent:case-copilot/v1@p1',
        event: 'proposal.create',
        detail_masked: {
          run_id: run!.run_id,
          type: 'open_dispute',
          flags: [],
          review_tier: 'standard',
        },
      },
    ]);
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
