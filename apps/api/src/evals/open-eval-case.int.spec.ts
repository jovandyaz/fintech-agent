import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CONTAINER_START_MS,
  startTestDatabase,
  type TestDatabase,
} from '../../test/database.js';
import type { Database } from '../database/index.js';
import * as schema from '../database/schema.js';
import { openEvalCase } from './open-eval-case.js';

const RECEIVED_AT = new Date('2026-10-05T21:00:00Z');
const HOST_NOW = new Date('2026-11-03T10:30:00-06:00');
const PAN = '4152313456781234';

let testDb: TestDatabase;
let owner: postgres.Sql;
let apiSql: postgres.Sql;
let db: Database;

beforeAll(async () => {
  testDb = await startTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 1 });
  apiSql = postgres(testDb.urlFor('copilot_api'), { max: 2 });
  db = drizzle({ client: apiSql, schema });
}, CONTAINER_START_MS);

afterAll(async () => {
  await apiSql?.end();
  await owner?.end();
  await testDb?.stop();
});

describe('openEvalCase (03 §Runner: eval cases take the intake path)', () => {
  it('queues a case marked eval, at the scenario time, with only the masked text', async () => {
    const opened = await openEvalCase(db, {
      customerId: 'cus_10',
      text: `Me rechazaron la compra, mi tarjeta es ${PAN}.`,
      receivedAt: RECEIVED_AT,
      now: HOST_NOW,
    });
    const [row] = await owner`
      select status, source, customer_id, received_at, text_masked, folio
      from cases where id = ${opened.case_id}`;
    expect(row).toMatchObject({
      status: 'queued',
      source: 'eval',
      customer_id: 'cus_10',
      received_at: RECEIVED_AT,
      folio: opened.folio,
    });
    expect(row!.text_masked).not.toContain(PAN);
  });

  it('records the event and its acknowledgment at the host time, so the trace scan windows them (02 G6)', async () => {
    const opened = await openEvalCase(db, {
      customerId: 'cus_13',
      text: 'Hola.',
      receivedAt: RECEIVED_AT,
      now: HOST_NOW,
    });
    const [event] = await owner`
      select received_at from webhook_events where case_id = ${opened.case_id}`;
    const [ack] = await owner`
      select at from audit_log where ref = ${opened.case_id}`;
    expect([event!.received_at, ack!.at]).toEqual([HOST_NOW, HOST_NOW]);
  });

  it('opens a new case each time, so every repeat is its own attempt', async () => {
    const input = {
      customerId: 'cus_13',
      text: 'Hola.',
      receivedAt: RECEIVED_AT,
      now: HOST_NOW,
    };
    const first = await openEvalCase(db, input);
    const second = await openEvalCase(db, input);
    expect(second.case_id).not.toBe(first.case_id);
  });

  it('acknowledges the case as opened by the eval runner', async () => {
    const opened = await openEvalCase(db, {
      customerId: 'cus_13',
      text: 'Hola.',
      receivedAt: RECEIVED_AT,
      now: HOST_NOW,
    });
    const audit = await owner`
      select actor, event from audit_log where ref = ${opened.case_id}`;
    expect(audit).toEqual([
      { actor: 'eval-runner', event: 'case.acknowledged' },
    ]);
  });
});
