import { EVENT_ID_PREFIX, TICKET_ID_PREFIX } from '@fintech-agent/contracts';
import type { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ANA, HTTP, NO_CORE, startApiApp } from '../../test/api-app.js';
import {
  CONTAINER_START_MS,
  startTestDatabase,
  type TestDatabase,
} from '../../test/database.js';

const PAN = '4761343220832617';
const USER_AGENT = 'console-cases-test';
// The masker reads digits mixed with letters as a number (02 G6), so an id the
// API mints carries letters only, like every other system id.
const LETTERS_ONLY_ID = (prefix: string) =>
  new RegExp(`^${prefix}[a-km-np-z]{12}$`);

let testDb: TestDatabase;
let owner: postgres.Sql;
let app: INestApplication;
let base: string;

beforeAll(async () => {
  testDb = await startTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 2 });
  ({ app, base } = await startApiApp(testDb, NO_CORE));
}, CONTAINER_START_MS);

afterAll(async () => {
  await app?.close();
  await owner?.end();
  await testDb?.stop();
});

const openCase = (body: unknown, token: string | null = ANA) =>
  fetch(`${base}/cases`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': USER_AGENT,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

const caseCount = async (): Promise<number> => {
  const [row] = await owner<
    { n: number }[]
  >`select count(*)::int as n from cases`;
  return row!.n;
};

describe('POST /cases, the console new case form (01 §Webhook and queue)', () => {
  it('queues one console case through the webhook intake and answers 202 with its folio', async () => {
    const response = await openCase({
      customer_id: 'cus_01',
      text: `No reconozco un cargo con la tarjeta ${PAN}.`,
    });
    expect(response.status).toBe(HTTP.accepted);
    const body = (await response.json()) as { case_id: string; folio: string };
    expect(Object.keys(body).sort()).toEqual(['case_id', 'folio']);
    const [stored] = await owner<
      {
        status: string;
        source: string;
        text_masked: string;
        folio: string;
        ticket_id: string;
      }[]
    >`select status, source, text_masked, folio, ticket_id from cases where id = ${body.case_id}`;
    expect(stored!.ticket_id).toMatch(LETTERS_ONLY_ID(TICKET_ID_PREFIX));
    expect(stored).toMatchObject({
      status: 'queued',
      source: 'console',
      folio: body.folio,
    });
    expect(stored!.text_masked).not.toContain(PAN);
    const events = await owner<{ event_id: string }[]>`
      select event_id from webhook_events where case_id = ${body.case_id}`;
    expect(events).toHaveLength(1);
    expect(events[0]!.event_id).toMatch(LETTERS_ONLY_ID(EVENT_ID_PREFIX));
  });

  it('records who opened the case, with the token key, address and user agent (02 G3)', async () => {
    const response = await openCase({ customer_id: 'cus_02', text: 'Hola.' });
    const { case_id } = (await response.json()) as { case_id: string };
    const [acknowledged] = await owner<
      {
        actor: string;
        key_id: string | null;
        ip: string | null;
        user_agent: string | null;
      }[]
    >`select actor, key_id, ip, user_agent from audit_log
      where ref = ${case_id} and event = 'case.acknowledged'`;
    expect(acknowledged).toMatchObject({
      actor: 'operator:ana',
      key_id: 'k1',
      user_agent: USER_AGENT,
    });
    expect(acknowledged?.ip).toBeTruthy();
  });

  it('refuses a request without an operator token with 401 and opens no case', async () => {
    const before = await caseCount();
    const response = await openCase(
      { customer_id: 'cus_01', text: 'Hola.' },
      null,
    );
    expect(response.status).toBe(HTTP.unauthorized);
    expect(await caseCount()).toBe(before);
  });

  it.each([
    ['an empty text', { customer_id: 'cus_01', text: '' }],
    ['no customer', { text: 'Hola.' }],
    [
      'an operator named in the body',
      { customer_id: 'cus_01', text: 'Hola.', operator: 'beto' },
    ],
    [
      'an id the operator chose',
      { customer_id: 'cus_01', text: 'Hola.', ticket_id: 'tkt-mine' },
    ],
  ])('refuses %s with 400 and opens no case', async (_, body) => {
    const before = await caseCount();
    const response = await openCase(body);
    expect(response.status).toBe(HTTP.badRequest);
    expect(await caseCount()).toBe(before);
  });
});
