import type { CaseStatus, CoreClient } from '@fintech-agent/contracts';
import type { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ANA, seedProposal, startApiApp } from '../../test/api-app.js';
import {
  CONTAINER_START_MS,
  startTestDatabase,
  type TestDatabase,
} from '../../test/database.js';

const STATUS = {
  ok: 200,
  unauthorized: 401,
  notFound: 404,
  conflict: 409,
} as const;
const FINAL = 'Hola Ana, ya revisamos tu caso.';
const RACES = 10;

const noCore: CoreClient = {
  customer: () => Promise.resolve(null),
  transaction: () => Promise.resolve(null),
  transactions: () => Promise.resolve(null),
};

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
  ({ app, base } = await startApiApp(db, noCore));
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
      expect(response.status).toBe(STATUS.ok);
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
    expect((await decide(actionId)).status).toBe(STATUS.ok);
    expect((await rerun(caseId)).status).toBe(STATUS.ok);
    expect(await state(caseId, actionId)).toEqual({
      case_status: 'queued',
      manual_reruns: 1,
      action_status: 'rejected',
    });
  });

  it('answers 409 to a decision on a superseded proposal', async () => {
    const { caseId, actionId } = await seeded();
    expect((await rerun(caseId)).status).toBe(STATUS.ok);
    expect((await decide(actionId)).status).toBe(STATUS.conflict);
  });

  it('refuses the fourth re-run', async () => {
    const { caseId } = await seeded();
    for (let i = 0; i < 3; i += 1) {
      await owner`update cases set status = 'needs_review' where id = ${caseId}`;
      expect((await rerun(caseId)).status).toBe(STATUS.ok);
    }
    await owner`update cases set status = 'needs_review' where id = ${caseId}`;
    expect((await rerun(caseId)).status).toBe(STATUS.conflict);
  });

  it.each(['queued', 'investigating'] as const)(
    'refuses a %s case',
    async (status) => {
      const { caseId, actionId } = await seeded(status);
      expect((await rerun(caseId)).status).toBe(STATUS.conflict);
      expect((await state(caseId, actionId))?.action_status).toBe('proposed');
    },
  );

  it('lets only one of two concurrent re-runs through', async () => {
    const { caseId } = await seeded();
    const statuses = await Promise.all([rerun(caseId), rerun(caseId)]).then(
      (responses) => responses.map(({ status }) => status).sort(),
    );
    expect(statuses).toEqual([STATUS.ok, STATUS.conflict]);
  });

  it('answers 404 for an unknown case and 401 without a token', async () => {
    expect((await rerun('case_nope')).status).toBe(STATUS.notFound);
    const { caseId } = await seeded();
    expect((await rerun(caseId, null)).status).toBe(STATUS.unauthorized);
  });

  it('audits the superseded proposal, not only the case', async () => {
    const { caseId, actionId } = await seeded();
    expect((await rerun(caseId)).status).toBe(STATUS.ok);
    const rows = await owner<{ ref: string; event: string; actor: string }[]>`
      select ref, event, actor from audit_log where ref in (${caseId}, ${actionId}) order by event`;
    expect(rows).toEqual([
      { ref: caseId, event: 'case.rerun', actor: 'operator:ana' },
      { ref: actionId, event: 'proposal.supersede', actor: 'operator:ana' },
    ]);
  });

  it('answers 409, never 500, when a re-run races a decision', async () => {
    for (let i = 0; i < RACES; i += 1) {
      const { caseId, actionId } = await seeded();
      const statuses = await Promise.all([
        rerun(caseId),
        decide(actionId),
      ]).then((responses) => responses.map(({ status }) => status).sort());
      expect(statuses).toEqual([STATUS.ok, STATUS.conflict]);
    }
  });
});

describe('re-runs of a canary case (02 G3)', () => {
  it('answers like a real re-run but never queues the case for the agent', async () => {
    const { caseId, actionId } = await seeded('needs_review', true);
    const response = await rerun(caseId);
    expect(response.status).toBe(STATUS.ok);
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

  it('refuses to re-run a canary that was already decided', async () => {
    const { caseId, actionId } = await seeded('needs_review', true);
    expect((await decide(actionId)).status).toBe(STATUS.ok);
    expect((await rerun(caseId)).status).toBe(STATUS.conflict);
    expect(
      (await proposalsOf(caseId)).every(({ is_canary }) => is_canary),
    ).toBe(true);
  });
});
