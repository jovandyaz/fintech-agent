import type { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ANA, HTTP, NO_CORE, startApiApp } from './api-app.js';
import {
  CONTAINER_START_MS,
  startTestDatabase,
  type TestDatabase,
} from './database.js';

const MAX_WEBHOOK_BODY_BYTES = 32 * 1024;
const JSON_FRAME_BYTES = '{"pad":""}'.length;
const FORWARDED_CLIENT = '203.0.113.7';
const LOOPBACK = '127.0.0.1';

let testDb: TestDatabase;
let owner: postgres.Sql;
let app: INestApplication;
let base: string;

beforeAll(async () => {
  testDb = await startTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 1 });
  ({ app, base } = await startApiApp(testDb, NO_CORE));
}, CONTAINER_START_MS);

afterAll(async () => {
  await app?.close();
  await owner?.end();
  await testDb?.stop();
});

const postBytes = (bytes: number) =>
  fetch(`${base}/actions/act_x/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pad: 'x'.repeat(bytes - JSON_FRAME_BYTES) }),
  });

describe('the api HTTP setup (01 §Webhook and queue, 02 T8)', () => {
  it('answers a body over 32 KB with 413, not 500', async () => {
    const response = await postBytes(MAX_WEBHOOK_BODY_BYTES + 1);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ statusCode: 413 });
  });

  it('lets a body of exactly 32 KB through the parser', async () => {
    const response = await postBytes(MAX_WEBHOOK_BODY_BYTES);
    expect(response.status).toBe(401);
  });

  it('answers a form-encoded body over 32 KB with 413 too', async () => {
    const response = await fetch(`${base}/actions/act_x/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `pad=${'x'.repeat(MAX_WEBHOOK_BODY_BYTES)}`,
    });
    expect(response.status).toBe(413);
  });

  it('answers malformed JSON with 400, not 500', async () => {
    const response = await fetch(`${base}/actions/act_x/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"truncated":',
    });
    expect(response.status).toBe(400);
  });
});

// The address an operator's case is acknowledged from, as audit_log keeps it.
async function auditedAddressVia(origin: string): Promise<string | null> {
  const response = await fetch(`${origin}/cases`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${ANA}`,
      'x-forwarded-for': FORWARDED_CLIENT,
    },
    body: JSON.stringify({ customer_id: 'cus_01', text: 'Hola.' }),
  });
  expect(response.status).toBe(HTTP.accepted);
  const { case_id } = (await response.json()) as { case_id: string };
  const [row] = await owner<{ ip: string | null }[]>`
    select ip from audit_log where ref = ${case_id} and event = 'case.acknowledged'`;
  return row?.ip ?? null;
}

describe('the operator address behind the console proxy (02 G3)', () => {
  it('records the forwarded address when the request comes from the trusted proxy', async () => {
    const trusting = await startApiApp(testDb, NO_CORE, false, {
      TRUST_PROXY: LOOPBACK,
    });
    try {
      expect(await auditedAddressVia(trusting.base)).toBe(FORWARDED_CLIENT);
    } finally {
      await trusting.app.close();
    }
  });

  it('trusts the proxy over IPv4 on a dual-stack socket, as production listens', async () => {
    const dualStack = await startApiApp(
      testDb,
      NO_CORE,
      false,
      { TRUST_PROXY: LOOPBACK },
      '::',
    );
    try {
      expect(await auditedAddressVia(dualStack.base)).toBe(FORWARDED_CLIENT);
    } finally {
      await dualStack.app.close();
    }
  });

  it('ignores a forwarded address from anyone else', async () => {
    const recorded = await auditedAddressVia(base);
    expect(recorded).not.toBe(FORWARDED_CLIENT);
    expect(recorded).toContain(LOOPBACK);
  });
});
