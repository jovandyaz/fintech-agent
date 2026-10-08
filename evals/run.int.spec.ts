import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runEvalCase, type EvalRun } from '@fintech-agent/api/evals';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { ApiProvider } from 'promptfoo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { investigation, mcpToolsOf } from '../apps/api/test/agent-fixtures.js';
import {
  CONTAINER_START_MS,
  startTestDatabase,
  type TestDatabase,
} from '../apps/api/test/database.js';
import { inOrder, objectResponse } from '../apps/api/test/mock-model.js';
import {
  CARD_TX,
  RECEIVED_AT,
  policyChunk,
  resolutionOf,
} from '../apps/api/test/validator-fixtures.js';
import {
  HAIKU_MODEL,
  SONNET_MODEL,
} from '../apps/api/src/agent/core/prices.js';
import type { RunCaseDeps } from '../apps/api/src/agent/core/run-case.js';
import * as schema from '../apps/api/src/database/schema.js';
import type { EvalCase } from './cases.js';
import { groundednessAssertion } from './judge/groundedness.js';
import { runEvals } from './run.js';
import { summarize } from './summary.js';

const HUGE = 1e9;
const MCP_URL = 'http://mcp.test/mcp';
const T0 = new Date('2026-10-07T15:01:00Z');

// The scripted harness investigates the shared card fixture, so the label
// is that run's: the pipeline is under test here, not the labeled set.
const SCRIPTED_LABEL: EvalCase = {
  id: 'CARD-UNREC-01',
  category: 'unrecognized_card_charge',
  action: { type: 'open_dispute', transaction_ids: [CARD_TX] },
  must_call: [{ tool: 'get_card_authorization', transaction_id: CARD_TX }],
  must_cite_doc: ['pol-04'],
  may_cite_doc: [],
  abstain: false,
  must_mention: [],
  high_stakes: true,
  rationale: 'the scripted card dispute of the api test fixtures',
};

let testDb: TestDatabase;
let owner: postgres.Sql;
let apiSql: postgres.Sql;
let configDir: string;
const configBefore = process.env['PROMPTFOO_CONFIG_DIR'];

const scriptedDeps = (): RunCaseDeps => ({
  db: drizzle({ client: apiSql, schema }),
  config: {
    mode: 'on',
    variant: 'A',
    modelId: SONNET_MODEL,
    redactorModelId: HAIKU_MODEL,
    runTimeoutMs: 180_000,
    budget: { costUsd: HUGE, inputTokens: HUGE },
    mcpUrl: MCP_URL,
    mcpAudience: MCP_URL,
    caseTokenKey: 'k'.repeat(32),
  },
  models: (modelId) =>
    modelId === HAIKU_MODEL
      ? inOrder(() => objectResponse({ spans: [] }))
      : inOrder(...investigation, () => objectResponse(resolutionOf())),
  canaryModels: () => {
    throw new Error('not a canary case');
  },
  retrieval: {
    catalog: [{ doc_id: 'pol-04', title: 'Cargos no reconocidos' }],
    search: () => Promise.resolve([policyChunk()]),
  },
  scanInjection: () => false,
  connectTools: () =>
    Promise.resolve({ tools: mcpToolsOf(), close: () => Promise.resolve() }),
  clock: () => T0.getTime(),
  random: () => 0.5,
  log: () => undefined,
});

const passingJudge: ApiProvider = {
  id: () => 'judge-local',
  callApi: () =>
    Promise.resolve({
      output: JSON.stringify({ pass: true, score: 1, reason: 'supported' }),
    }),
};

beforeAll(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'evals-run-'));
  process.env['PROMPTFOO_CONFIG_DIR'] = configDir;
  testDb = await startTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  apiSql = postgres(testDb.urlFor('copilot_api'), { max: 4 });
}, CONTAINER_START_MS);

afterAll(async () => {
  await apiSql?.end();
  await owner?.end();
  await testDb?.stop();
  if (configBefore === undefined) {
    Reflect.deleteProperty(process.env, 'PROMPTFOO_CONFIG_DIR');
  } else process.env['PROMPTFOO_CONFIG_DIR'] = configBefore;
  await rm(configDir, { recursive: true, force: true });
});

describe('the eval runner end to end (scripted model, real Postgres, no key)', () => {
  it('runs a high-stakes case three times to a proposal, grades it and never executes it', async () => {
    const { results, outcomes } = await runEvals({
      cases: [SCRIPTED_LABEL],
      attempts: new Map([
        [
          'A',
          (fixture): Promise<EvalRun> =>
            runEvalCase(scriptedDeps(), {
              customerId: 'cus_01',
              text: fixture.text,
              receivedAt: RECEIVED_AT,
            }),
        ],
      ]),
      repeat: null,
      groundedness: groundednessAssertion(passingJudge, 'rubric'),
    });
    expect(outcomes).toEqual([
      expect.objectContaining({
        caseId: 'CARD-UNREC-01',
        providerId: 'variant-A',
        trials: 3,
        passes: 3,
        unrunAttempts: 0,
        passAll: true,
      }),
    ]);
    const summary = summarize({
      results,
      cases: [SCRIPTED_LABEL],
      variants: ['variant-A'],
      judgeModel: 'claude-opus-5-5',
      judgeCounts: false,
      baseline: null,
      full: false,
      redactor: null,
      date: '2026-10-08',
      commit: 'abc1234',
    });
    const [report] = summary.reports;
    expect(report).toMatchObject({
      attempts: 3,
      passAll: { successes: 1, n: 1 },
      groundedness: { successes: 1, n: 1 },
      unauthorizedExecutions: 0,
    });
    expect(summary.gate).toEqual([]);
    const cases = await owner<{ status: string }[]>`
      select status from cases where source = 'eval'`;
    expect(cases.map(({ status }) => status)).toEqual([
      'needs_review',
      'needs_review',
      'needs_review',
    ]);
    const [executions] =
      await owner`select count(*)::int as n from action_executions`;
    expect(executions).toEqual({ n: 0 });
  });
});
