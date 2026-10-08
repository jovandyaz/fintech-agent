import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CONTAINER_START_MS,
  insertCase,
  startTestDatabase,
  type TestDatabase,
} from '../../test/database.js';
import { evalHarness, type EvalHarness } from './eval-harness.js';

const ENV_EXAMPLE = readFileSync(
  resolve(import.meta.dirname, '../../../../.env.example'),
  'utf8',
);

let testDb: TestDatabase;
let owner: postgres.Sql;
let harness: EvalHarness;

beforeAll(async () => {
  testDb = await startTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  harness = evalHarness({
    env: { API_DATABASE_URL: testDb.urlFor('copilot_api') },
    envExample: ENV_EXAMPLE,
    log: () => undefined,
  });
}, CONTAINER_START_MS);

afterAll(async () => {
  await harness?.close();
  await owner?.end();
  await testDb?.stop();
});

describe('evalHarness against the database (03 §Runner)', () => {
  it('fails the eval cases an earlier run left behind, as copilot_api', async () => {
    await insertCase(owner, 'case_left');
    await owner`update cases set source = 'eval' where id = 'case_left'`;
    expect(await harness.failLeftovers(new Date())).toEqual(['case_left']);
    const [row] = await owner`select status from cases where id = 'case_left'`;
    expect(row).toEqual({ status: 'failed' });
  });
});
