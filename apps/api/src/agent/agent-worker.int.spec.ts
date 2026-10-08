import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { testApiConfig } from '../../test/api-config.js';
import {
  CONTAINER_START_MS,
  insertCase,
  startTestDatabase,
  type TestDatabase,
} from '../../test/database.js';
import { AppModule } from '../app.module.js';
import { AGENT_CONFIG } from './agent-worker.module.js';
import { agentConfigOf } from './core/deps.js';

const POLL_MS = '25';
const SETTLE_MS = 15_000;
const IDLE_POLLS_MS = 500;
const TEST_MS = 20_000;

let testDb: TestDatabase;
let owner: postgres.Sql;
let sequence = 0;

beforeAll(async () => {
  testDb = await startTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 2 });
}, CONTAINER_START_MS);

afterAll(async () => {
  await owner?.end();
  await testDb?.stop();
});

async function withApi(
  env: Record<string, string>,
  body: () => Promise<void>,
): Promise<void> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AppModule.register(
        testApiConfig({
          API_DATABASE_URL: testDb.urlFor('copilot_api'),
          AGENT_POLL_MS: POLL_MS,
          ...env,
        }),
      ),
    ],
  }).compile();
  const app: INestApplication = moduleRef.createNestApplication({
    logger: false,
  });
  await app.init();
  try {
    await body();
  } finally {
    await app.close();
  }
}

const queuedCase = async (): Promise<string> => {
  const id = `case_aw${++sequence}`;
  await insertCase(owner, id, 'cus_01');
  return id;
};

const caseRow = async (id: string) => {
  const [row] = await owner<{ status: string }[]>`
    select status from cases where id = ${id}`;
  return row!;
};
const runOf = async (caseId: string) => {
  const [row] = await owner<
    { stop_reason: string | null; error_code: string | null }[]
  >`select stop_reason, error_code from agent_runs where case_id = ${caseId}`;
  return row;
};

describe('the agent worker inside api (01 §Components, §Webhook and queue)', () => {
  it('hands the worker only the agent variables, never the core read key (02 G4)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        AppModule.register(
          testApiConfig({
            API_DATABASE_URL: testDb.urlFor('copilot_api'),
            AGENT_MODE: 'off',
          }),
        ),
      ],
    }).compile();
    try {
      const held = moduleRef.get<Record<string, unknown>>(AGENT_CONFIG, {
        strict: false,
      });
      expect(Object.keys(held).sort()).toEqual(
        Object.keys(agentConfigOf(testApiConfig())).sort(),
      );
    } finally {
      await moduleRef.close();
    }
  });

  it(
    'claims a queued case and, with the kill switch on, proposes none without a model',
    async () => {
      const id = await queuedCase();
      await withApi({ AGENT_MODE: 'off' }, async () => {
        await vi.waitFor(
          async () => expect((await caseRow(id)).status).toBe('needs_review'),
          { timeout: SETTLE_MS, interval: Number(POLL_MS) },
        );
      });
      expect(await runOf(id)).toMatchObject({ stop_reason: 'agent_disabled' });
    },
    TEST_MS,
  );

  it(
    'fails a claimed case at once as no_api_key when no key is set',
    async () => {
      const id = await queuedCase();
      await withApi({ AGENT_MODE: 'on', ANTHROPIC_API_KEY: '' }, async () => {
        await vi.waitFor(
          async () => expect((await caseRow(id)).status).toBe('failed'),
          { timeout: SETTLE_MS, interval: Number(POLL_MS) },
        );
      });
      expect(await runOf(id)).toMatchObject({ error_code: 'no_api_key' });
    },
    TEST_MS,
  );

  it('claims nothing with AGENT_WORKER=off, and the api still boots', async () => {
    const id = await queuedCase();
    await withApi({ AGENT_WORKER: 'off', AGENT_MODE: 'off' }, async () => {
      await new Promise((resolve) => setTimeout(resolve, IDLE_POLLS_MS));
      expect((await caseRow(id)).status).toBe('queued');
    });
    expect(await runOf(id)).toBeUndefined();
  });
});
