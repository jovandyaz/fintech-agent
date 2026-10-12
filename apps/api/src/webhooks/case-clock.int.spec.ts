import type { CaseSource } from '@fintech-agent/contracts';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CONTAINER_START_MS,
  startTestDatabase,
  type TestDatabase,
} from '../../test/database.js';
import type { Database } from '../database/index.js';
import * as schema from '../database/schema.js';
import {
  CaseClockUnrecordedError,
  WALL_CLOCK,
  datasetClock,
  RECORDED_CLOCK,
  recordCaseClock,
  type CaseClock,
} from './case-clock.js';
import { WEBHOOK_SENDER } from './delivery.js';
import { intakeEvent } from './intake.js';

const START = new Date('2026-10-05T15:00:00-06:00');
const HOST_NOW = new Date('2026-11-03T10:30:00-06:00');
const NINETY_SECONDS_MS = 90_000;
const NEXT_HOST_DAY = new Date('2026-11-04T09:15:00-06:00');

let testDb: TestDatabase;
let owner: postgres.Sql;
let api: postgres.Sql;
let db: Database;
let sequence = 0;

beforeAll(async () => {
  testDb = await startTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  api = postgres(testDb.urlFor('copilot_api'), { max: 1 });
  db = drizzle(api, { schema });
}, CONTAINER_START_MS);

afterAll(async () => {
  await api?.end();
  await owner?.end();
  await testDb?.stop();
});

beforeEach(async () => {
  await owner`truncate cases, webhook_events, audit_log cascade`;
});

async function open(
  now: Date,
  clock: CaseClock,
  source: CaseSource = 'webhook',
): Promise<{ caseAt: Date; eventAt: Date }> {
  const n = ++sequence;
  const { case_id } = await intakeEvent(db, {
    event: {
      event_id: `evt-clock-${n}`,
      ticket_id: `tkt-clock-${n}`,
      customer_id: 'cus_01',
      text: 'Mandé un SPEI ayer y no ha llegado.',
      created_at: now.toISOString(),
    },
    payloadHash: `hash-${n}`,
    source,
    opener: WEBHOOK_SENDER,
    now,
    clock,
  });
  const [row] = await owner<{ case_at: Date; event_at: Date }[]>`
    select c.received_at as case_at, e.received_at as event_at
    from cases c join webhook_events e on e.case_id = c.id
    where c.id = ${case_id}`;
  return { caseAt: row!.case_at, eventAt: row!.event_at };
}

describe('case clock (01 §Webhook and queue, Case clock)', () => {
  it('stamps the case with the host time on the wall clock', async () => {
    expect(await open(HOST_NOW, WALL_CLOCK)).toEqual({
      caseAt: HOST_NOW,
      eventAt: HOST_NOW,
    });
  });

  it('receives the first live case at the dataset start and keeps the event row on host time', async () => {
    expect(await open(HOST_NOW, datasetClock(START))).toEqual({
      caseAt: START,
      eventAt: HOST_NOW,
    });
  });

  it('advances later cases by the host time elapsed since the first live case', async () => {
    const clock = datasetClock(START);
    await open(HOST_NOW, clock);
    const later = new Date(HOST_NOW.getTime() + NINETY_SECONDS_MS);
    expect((await open(later, clock)).caseAt).toEqual(
      new Date(START.getTime() + NINETY_SECONDS_MS),
    );
  });

  it('counts console cases as live and never anchors on an eval case', async () => {
    const clock = datasetClock(START);
    await open(START, WALL_CLOCK, 'eval');
    expect((await open(HOST_NOW, clock, 'console')).caseAt).toEqual(START);
    const later = new Date(HOST_NOW.getTime() + NINETY_SECONDS_MS);
    expect((await open(later, clock)).caseAt).toEqual(
      new Date(START.getTime() + NINETY_SECONDS_MS),
    );
  });

  it('starts over on each Mexico City day, so the data stays today', async () => {
    const clock = datasetClock(START);
    await open(HOST_NOW, clock);
    expect((await open(NEXT_HOST_DAY, clock)).caseAt).toEqual(START);
  });

  it('receives a case delivered before the anchor (host clocks apart) at the start', async () => {
    const clock = datasetClock(START);
    await open(HOST_NOW, clock);
    const earlier = new Date(HOST_NOW.getTime() - NINETY_SECONDS_MS);
    expect((await open(earlier, clock)).caseAt).toEqual(START);
  });
});

describe('the recorded case clock (01 Case clock, 02 G3)', () => {
  beforeEach(async () => {
    await owner`truncate case_clock`;
  });

  it('refuses to name a clock api never recorded, so a canary never guesses one', async () => {
    await expect(open(HOST_NOW, RECORDED_CLOCK)).rejects.toThrow(
      CaseClockUnrecordedError,
    );
    const [kept] = await owner<{ n: number }[]>`
      select count(*)::int as n from webhook_events`;
    expect(kept?.n).toBe(0);
  });

  it('receives each case on the clock api last booted with, even one recorded mid-injection', async () => {
    await recordCaseClock(db, { CASE_CLOCK: 'wall', CASE_CLOCK_START: START });
    await recordCaseClock(db, {
      CASE_CLOCK: 'dataset',
      CASE_CLOCK_START: START,
    });
    expect((await open(HOST_NOW, RECORDED_CLOCK)).caseAt).toEqual(START);
    await recordCaseClock(db, { CASE_CLOCK: 'wall', CASE_CLOCK_START: START });
    const later = new Date(HOST_NOW.getTime() + NINETY_SECONDS_MS);
    expect((await open(later, RECORDED_CLOCK)).caseAt).toEqual(later);
  });
});
