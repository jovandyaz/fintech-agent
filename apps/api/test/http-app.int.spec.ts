import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { NO_CORE, startApiApp } from './api-app.js';
import {
  CONTAINER_START_MS,
  startTestDatabase,
  type TestDatabase,
} from './database.js';

const MAX_WEBHOOK_BODY_BYTES = 32 * 1024;
const JSON_FRAME_BYTES = '{"pad":""}'.length;

let testDb: TestDatabase;
let app: INestApplication;
let base: string;

beforeAll(async () => {
  testDb = await startTestDatabase();
  ({ app, base } = await startApiApp(testDb, NO_CORE));
}, CONTAINER_START_MS);

afterAll(async () => {
  await app?.close();
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
