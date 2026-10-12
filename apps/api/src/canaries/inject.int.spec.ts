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
import { WALL_CLOCK, datasetClock } from '../webhooks/case-clock.js';
import { injectCanaries, type InjectPacing } from './inject.js';
import {
  CANARY_DEFECTS,
  CANARY_TEMPLATES,
  canaryTemplateOf,
  type CanaryDefect,
} from './templates.js';

const SPREAD_MS = 60_000;
const RUN_TIMEOUT_MS = 180_000;
const FIRST_DRAW = 0;
const LAST_DRAW = 0.999;
const TEMPLATE_DEFECTS = CANARY_TEMPLATES.map(({ defect }) => defect);
const DATASET_START = new Date('2026-10-05T15:00:00-06:00');
const MS_PER_HOUR = 3_600_000;

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
    caseClock: WALL_CLOCK,
    random: () => draws[draw++ % draws.length]!,
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
  };
}

const inject = (paced = pacing()) =>
  injectCanaries(drizzle({ client: api, schema }), paced);

const templateOf = (row: {
  customer_id: string;
  text_masked: string;
  defect: CanaryDefect;
}) =>
  canaryTemplateOf({
    defect: row.defect,
    customerId: row.customer_id,
    textMasked: row.text_masked,
  });

describe('canary:inject (02 G3)', () => {
  it('posts one queued case per template through the webhook intake, each with its marker', async () => {
    const caseIds = await inject();
    expect(caseIds).toHaveLength(CANARY_TEMPLATES.length);

    const rows = await owner<
      {
        id: string;
        customer_id: string;
        status: string;
        source: string;
        folio: string;
        text_masked: string;
        defect: CanaryDefect;
        events: number;
        acknowledged: string | null;
        proposals: number;
      }[]
    >`
      select c.id, c.customer_id, c.status, c.source, c.folio, c.text_masked, m.defect,
        (select count(*)::int from webhook_events e where e.case_id = c.id) as events,
        (select actor from audit_log a where a.ref = c.id and a.event = 'case.acknowledged') as acknowledged,
        (select count(*)::int from proposed_actions p where p.case_id = c.id) as proposals
      from cases c join canary_cases m on m.case_id = c.id
      where c.id in ${owner(caseIds)}`;
    for (const row of rows) {
      expect(row).toMatchObject({
        status: 'queued',
        source: 'webhook',
        events: 1,
        acknowledged: 'intake:webhook',
        proposals: 0,
      });
      expect(isFolio(row.folio)).toBe(true);
    }
    expect(new Set(rows.map(templateOf))).toEqual(new Set(CANARY_TEMPLATES));
    expect(new Set(rows.map(({ defect }) => defect))).toEqual(
      new Set(CANARY_DEFECTS),
    );
  });

  it.each([
    ['first', FIRST_DRAW, 0],
    ['last', LAST_DRAW, -1],
  ] as const)(
    "words each case with its template's %s phrasing when the draw says so",
    async (_, draw, index) => {
      const caseIds = await inject({ ...pacing(), random: () => draw });
      const rows = await owner<
        { customer_id: string; text_masked: string; defect: CanaryDefect }[]
      >`
        select c.customer_id, c.text_masked, m.defect
        from cases c join canary_cases m on m.case_id = c.id
        where c.id in ${owner(caseIds)}`;
      expect(rows).toHaveLength(CANARY_TEMPLATES.length);
      for (const row of rows) {
        expect(row.text_masked).toBe(
          maskPii(templateOf(row).seed.texts.at(index)!),
        );
      }
    },
  );

  it("receives each case on the clock it is given, a sender's case's own (01 Case clock)", async () => {
    const caseIds = await inject({
      ...pacing(),
      caseClock: datasetClock(DATASET_START),
    });
    const rows = await owner<{ received_at: Date }[]>`
      select received_at from cases where id in ${owner(caseIds)}`;
    expect(rows).toHaveLength(CANARY_TEMPLATES.length);
    for (const { received_at } of rows) {
      expect(received_at.getTime()).toBeGreaterThanOrEqual(
        DATASET_START.getTime(),
      );
      expect(received_at.getTime()).toBeLessThan(
        DATASET_START.getTime() + MS_PER_HOUR,
      );
    }
  });

  it('spreads the cases over the window, in shuffled order', async () => {
    const paced = pacing(SPREAD_MS);
    const caseIds = await inject(paced);
    expect(paced.slept).toHaveLength(CANARY_TEMPLATES.length);
    expect(paced.slept.every((ms) => ms >= 0)).toBe(true);
    const waited = paced.slept.reduce((total, ms) => total + ms, 0);
    expect(waited).toBeGreaterThan(0);
    expect(waited).toBeLessThanOrEqual(SPREAD_MS);
    const defects = await owner<{ defect: string }[]>`
      select m.defect from canary_cases m join cases c on c.id = m.case_id
      where c.id in ${owner(caseIds)} order by c.received_at, c.id`;
    expect(defects.map(({ defect }) => defect)).not.toEqual(TEMPLATE_DEFECTS);
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
