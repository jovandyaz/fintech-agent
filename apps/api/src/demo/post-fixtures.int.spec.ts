import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parseWebhookSecrets } from '@fintech-agent/contracts';
import type { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  HTTP,
  NO_CORE,
  WEBHOOK_SECRET,
  startApiApp,
} from '../../test/api-app.js';
import {
  CONTAINER_START_MS,
  startTestDatabase,
  type TestDatabase,
} from '../../test/database.js';
import { payloadHashOf } from '../webhooks/intake.js';
import { postFixtures } from './post-fixtures.js';

const FIXTURES_DIR = resolve(
  import.meta.dirname,
  '../../../../data/webhook-fixtures',
);
const [SECRET] = parseWebhookSecrets(WEBHOOK_SECRET);

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

const post = (ids: string[]) =>
  postFixtures({
    ids,
    apiUrl: base,
    secret: SECRET,
    fixturesDir: FIXTURES_DIR,
    now: () => new Date(),
  });

describe('pnpm demo:post (04 Step 7)', () => {
  it('signs each fixture so the webhook verifies it and queues its case', async () => {
    const posted = await post(['ADV-01', 'SPEI-IN-01']);
    expect(posted.map(({ status }) => status)).toEqual([
      HTTP.accepted,
      HTTP.accepted,
    ]);
    const stored = await owner<{ ticket_id: string; source: string }[]>`
      select ticket_id, source from cases where ticket_id in ('tkt-adv-01', 'tkt-spei-in-01')`;
    expect(stored).toHaveLength(2);
    expect(stored.every(({ source }) => source === 'webhook')).toBe(true);
  });

  it('signs and sends the fixture file byte for byte', async () => {
    await post(['CARD-UNREC-01']);
    const bytes = await readFile(resolve(FIXTURES_DIR, 'CARD-UNREC-01.json'));
    const [event] = await owner<{ payload_hash: string }[]>`
      select payload_hash from webhook_events where event_id = 'evt-card-unrec-01'`;
    expect(event?.payload_hash).toBe(payloadHashOf(bytes));
  });

  it('posts the fixture bytes as they are, so posting again is a replay', async () => {
    const [first] = await post(['GEN-01']);
    const [again] = await post(['GEN-01']);
    expect(again?.status).toBe(HTTP.ok);
    expect(again?.body).toEqual(first?.body);
  });

  it.each([
    ['a path', '../../.env', /not a fixture id/],
    ['a name in the wrong case', 'adv-01', /not a fixture id/],
    ['a fixture that does not exist', 'NOPE-99', /ENOENT/],
  ])('refuses %s before posting anything', async (_, id, reason) => {
    const [before] = await owner<{ n: number }[]>`
      select count(*)::int as n from webhook_events`;
    await expect(post(['CARD-DECL-01', id])).rejects.toThrow(reason);
    const [after] = await owner<{ n: number }[]>`
      select count(*)::int as n from webhook_events`;
    expect(after?.n).toBe(before?.n);
  });
});
