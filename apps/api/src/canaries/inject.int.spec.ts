import { isFolio, maskPii } from '@fintech-agent/contracts';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CONTAINER_START_MS,
  startTestDatabase,
  type TestDatabase,
} from '../../test/database.js';
import { claimNextCase } from '../agent/core/queue.js';
import * as schema from '../database/schema.js';
import { injectCanaries, type InjectPacing } from './inject.js';
import {
  CANARY_DEFECTS,
  CANARY_TEMPLATES,
  type CanaryDefect,
} from './templates.js';

const SPREAD_MS = 60_000;
const RUN_TIMEOUT_MS = 180_000;

let db: TestDatabase;
let owner: postgres.Sql;
let api: postgres.Sql;

beforeAll(async () => {
  db = await startTestDatabase();
  owner = postgres(db.ownerUrl, { max: 1, onnotice: () => undefined });
  api = postgres(db.urlFor('copilot_api'), { max: 1 });
}, CONTAINER_START_MS);

afterAll(async () => {
  await api?.end();
  await owner?.end();
  await db?.stop();
});

// A fixed cycle of draws, so the shuffle and the spread are reproducible.
function pacing(spreadMs = 0): InjectPacing & { slept: number[] } {
  const draws = [0.9, 0.1, 0.6, 0.3, 0.8, 0.2, 0.5, 0.7, 0.4, 0.05];
  let draw = 0;
  const slept: number[] = [];
  return {
    slept,
    spreadMs,
    now: () => new Date(),
    random: () => draws[draw++ % draws.length]!,
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
  };
}

const inject = (paced = pacing()) =>
  injectCanaries(drizzle({ client: api, schema }), paced);

describe('canary:inject (02 G3)', () => {
  it('posts one queued case per defect through the webhook intake, each with its marker', async () => {
    const caseIds = await inject();
    expect(caseIds).toHaveLength(CANARY_DEFECTS.length);

    const rows = await owner<
      {
        id: string;
        status: string;
        source: string;
        folio: string;
        text_masked: string;
        defect: string;
        events: number;
        acknowledged: string | null;
        proposals: number;
      }[]
    >`
      select c.id, c.status, c.source, c.folio, c.text_masked, m.defect,
        (select count(*)::int from webhook_events e where e.case_id = c.id) as events,
        (select actor from audit_log a where a.ref = c.id and a.event = 'case.acknowledged') as acknowledged,
        (select count(*)::int from proposed_actions p where p.case_id = c.id) as proposals
      from cases c join canary_cases m on m.case_id = c.id
      where c.id in ${owner(caseIds)}`;
    expect(rows.map(({ defect }) => defect).sort()).toEqual(
      [...CANARY_DEFECTS].sort(),
    );
    for (const row of rows) {
      expect(row).toMatchObject({
        status: 'queued',
        source: 'webhook',
        events: 1,
        acknowledged: 'intake:webhook',
        proposals: 0,
      });
      expect(isFolio(row.folio)).toBe(true);
      const { seed } = CANARY_TEMPLATES.find(
        ({ defect }) => defect === row.defect,
      )!;
      expect(row.text_masked).toBe(maskPii(seed.text));
    }
  });

  it('spreads the cases over the window, in shuffled order', async () => {
    const paced = pacing(SPREAD_MS);
    const caseIds = await inject(paced);
    expect(paced.slept).toHaveLength(CANARY_DEFECTS.length);
    expect(paced.slept.every((ms) => ms >= 0)).toBe(true);
    const waited = paced.slept.reduce((total, ms) => total + ms, 0);
    expect(waited).toBeGreaterThan(0);
    expect(waited).toBeLessThanOrEqual(SPREAD_MS);
    const defects = await owner<{ defect: string }[]>`
      select m.defect from canary_cases m join cases c on c.id = m.case_id
      where c.id in ${owner(caseIds)} order by c.received_at, c.id`;
    expect(defects.map(({ defect }) => defect)).not.toEqual(CANARY_DEFECTS);
  });

  it('keeps no case when its marker cannot be written, so none runs unscripted', async () => {
    const [template] = CANARY_TEMPLATES;
    const unscriptable = {
      ...template!,
      defect: 'made_up' as CanaryDefect,
    };
    const count = async () => {
      const [row] = await owner<{ cases: number; events: number }[]>`
        select (select count(*)::int from cases) as cases,
          (select count(*)::int from webhook_events) as events`;
      return row;
    };
    const before = await count();
    await expect(
      injectCanaries(drizzle({ client: api, schema }), pacing(), [
        unscriptable,
      ]),
    ).rejects.toThrow();
    expect(await count()).toEqual(before);
  });

  it('leaves each canary case for the worker to claim like any case', async () => {
    await owner`update cases set status = 'resolved' where status = 'queued'`;
    const [caseId] = await inject(pacing());
    await owner`update cases set status = 'resolved' where status = 'queued' and id <> ${caseId!}`;
    const claim = await claimNextCase(drizzle({ client: api, schema }), {
      now: new Date(Date.now() + 1),
      runTimeoutMs: RUN_TIMEOUT_MS,
    });
    expect(claim?.caseId).toBe(caseId);
  });
});
