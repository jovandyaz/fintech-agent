import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';

import {
  CustomerRecordSchema,
  TransactionRecordSchema,
  createCoreClient,
  maskPii,
} from '@fintech-agent/contracts';
import { createCoreMock, type CoreMock } from '@fintech-agent/core-mock';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createMcpApp, type McpApp } from '../../../mcp/src/app.js';
import {
  CONTAINER_START_MS,
  insertCase,
  startTestDatabase,
  type TestDatabase,
} from '../../test/database.js';
import { keyPathsOf } from '../../test/key-paths.js';
import { HAIKU_MODEL, SONNET_MODEL } from '../agent/core/prices.js';
import type { Claim } from '../agent/core/queue.js';
import { runCase, type RunCaseDeps } from '../agent/core/run-case.js';
import { connectCaseTools } from '../agent/core/tools.js';
import { reviewTierOf } from '../cases/review-tier.js';
import { caseDetailOf } from '../console/read-model.js';
import type { Database } from '../database/index.js';
import * as schema from '../database/schema.js';
import { injectionSignal } from '../guard/prompt-guard.js';
import { seedPolicies } from '../retrieval/corpus-write.js';
import { POLICIES_DIR, loadManifest } from '../retrieval/ingest.js';
import { createRetrieval, policyCatalog } from '../retrieval/search.js';
import { canaryModelsOf, investigationOf } from './script.js';
import {
  CANARY_TEMPLATES,
  canaryTemplateOf,
  type CanaryDefect,
  type CanarySeed,
} from './templates.js';

const DATA_DIR = resolve(import.meta.dirname, '../../../../data');
const READ_KEY = 'test-core-read-key';
const CASE_TOKEN_KEY = 'test-case-token-key-with-at-least-32-bytes';
const AUDIENCE = 'http://mcp.internal/mcp';
const RUN_TIMEOUT_MS = 180_000;
const LEASE_MARGIN_MS = 30_000;
const NO_BUDGET_LIMIT = 1e9;

const dataset = <T>(file: string, schema: z.ZodType<T>): T[] =>
  z
    .array(schema)
    .parse(JSON.parse(readFileSync(resolve(DATA_DIR, file), 'utf8')));

let testDb: TestDatabase;
let owner: postgres.Sql;
let apiSql: postgres.Sql;
let db: Database;
let core: CoreMock;
let mcp: McpApp;
let mcpUrl: string;
let coreUrl: string;
let sequence = 0;

function listen(server: Server): Promise<string> {
  return new Promise((ready) => {
    server.listen(0, '127.0.0.1', () => {
      ready(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });
}

const closeServer = (server: Server): Promise<void> =>
  new Promise((done) => server.close(() => done()));

beforeAll(async () => {
  testDb = await startTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 2 });
  apiSql = postgres(testDb.urlFor('copilot_api'), { max: 4 });
  db = drizzle({ client: apiSql, schema });
  await seedPolicies(testDb.ownerUrl, POLICIES_DIR);
  core = createCoreMock({
    customers: dataset('customers.json', CustomerRecordSchema),
    transactions: dataset('transactions.json', TransactionRecordSchema),
    readKey: READ_KEY,
    executorKey: 'test-executor-key',
    databasePath: ':memory:',
    log: () => undefined,
  });
  coreUrl = await listen(core.server);
  mcp = createMcpApp({
    coreUrl,
    coreReadKey: READ_KEY,
    caseTokenKey: CASE_TOKEN_KEY,
    audience: AUDIENCE,
    securityEvents: { record: () => Promise.resolve() },
    log: () => undefined,
  });
  mcpUrl = `${await listen(mcp.server)}/mcp`;
}, CONTAINER_START_MS);

afterAll(async () => {
  if (mcp) await closeServer(mcp.server);
  if (core) {
    await closeServer(core.server);
    core.close();
  }
  await apiSql?.end();
  await owner?.end();
  await testDb?.stop();
});

function depsFor(providerCalls: string[]): RunCaseDeps {
  return {
    db,
    config: {
      mode: 'on',
      variant: 'A',
      modelId: SONNET_MODEL,
      redactorModelId: HAIKU_MODEL,
      runTimeoutMs: RUN_TIMEOUT_MS,
      budget: { costUsd: NO_BUDGET_LIMIT, inputTokens: NO_BUDGET_LIMIT },
      mcpUrl,
      mcpAudience: AUDIENCE,
      caseTokenKey: CASE_TOKEN_KEY,
    },
    models: (modelId) => {
      providerCalls.push(modelId);
      throw new Error('the provider model was reached');
    },
    canaryModels: (defect) =>
      canaryModelsOf(canaryTemplateOf(defect), {
        redactorModelId: HAIKU_MODEL,
        agentModelId: SONNET_MODEL,
        pacing: SCRIPT_PACING,
      }),
    retrieval: createRetrieval(db, policyCatalog(loadManifest(POLICIES_DIR))),
    scanInjection: injectionSignal,
    connectTools: connectCaseTools,
    clock: () => Date.now(),
    random: () => 0.5,
    log: () => undefined,
  };
}

const SCRIPT_PACING = { random: () => 0.5, sleep: () => Promise.resolve() };

// A case claimed for its first attempt, with the seed's text masked as the
// webhook stores it; a defect also marks it a canary.
async function claimedCase(
  seed: CanarySeed,
  defect?: CanaryDefect,
): Promise<Claim> {
  const caseId = `case_cr${++sequence}`;
  const claimToken = randomUUID();
  await insertCase(owner, caseId, seed.customerId);
  await owner`
    update cases set status = 'investigating', text_masked = ${maskPii(seed.text)},
      claim_token = ${claimToken}, attempts = 1,
      locked_until = ${new Date(Date.now() + RUN_TIMEOUT_MS + LEASE_MARGIN_MS)}
    where id = ${caseId}`;
  if (defect) {
    await owner`insert into canary_cases (case_id, defect) values (${caseId}, ${defect})`;
  }
  return { caseId, claimToken, attempt: 1 };
}

describe('a canary through the real harness (02 G3, G5)', () => {
  it.each(CANARY_TEMPLATES)(
    '$defect investigates with real tools and lands its seed proposal, never on the provider',
    async ({ defect, seed }) => {
      const claim = await claimedCase(seed, defect);
      const { caseId } = claim;
      const providerCalls: string[] = [];

      expect(await runCase(depsFor(providerCalls), claim)).toEqual({
        kind: 'persisted',
        runStatus: 'succeeded',
      });
      expect(providerCalls).toEqual([]);

      const [kase] = await owner<
        {
          status: string;
          flags: string[];
          review_tier: string;
          category: string;
          text_redacted: string;
        }[]
      >`select status, flags, review_tier, category, text_redacted from cases where id = ${caseId}`;
      expect(kase).toEqual({
        status: 'needs_review',
        flags: seed.flags,
        review_tier: reviewTierOf(seed.action.type, seed.flags),
        category: seed.category,
        text_redacted: maskPii(seed.text),
      });
      const [proposal] = await owner<
        {
          agent_type: string;
          agent_params: unknown;
          is_canary: boolean;
          run_id: string;
        }[]
      >`select agent_type, agent_params, is_canary, run_id from proposed_actions where case_id = ${caseId}`;
      expect(proposal).toMatchObject({
        agent_type: seed.action.type,
        agent_params: {
          transaction_ids: seed.action.transaction_ids,
          reason_code: seed.action.reason_code,
        },
        is_canary: true,
      });
      const [resolution] = await owner<
        { draft_reply: string; citations: unknown; folio: string }[]
      >`select r.draft_reply, r.citations, c.folio from resolutions r
          join agent_runs a on a.id = r.run_id join cases c on c.id = a.case_id
          where r.run_id = ${proposal!.run_id}`;
      // Persist fills the placeholders, as it does for a real proposal.
      expect(resolution!.draft_reply).not.toContain('{{');
      if (seed.draftReply.includes('{{folio}}')) {
        expect(resolution!.draft_reply).toContain(resolution!.folio);
      }
      expect(resolution!.citations).toEqual(seed.citations);
      const steps = await owner<{ kind: string; name: string }[]>`
        select kind, name from run_steps where run_id = ${proposal!.run_id} order by idx`;
      expect(steps.slice(0, 2).map(({ name }) => name)).toEqual([
        'redaction',
        'injection_scan',
      ]);
      expect(
        steps
          .filter(({ kind }) => kind === 'tool' || kind === 'retrieval')
          .map(({ name }) => name),
      ).toEqual(investigationOf(seed).map(({ tool }) => tool));
    },
  );

  it('reads in the console exactly like a real case that ran the same investigation', async () => {
    const template = canaryTemplateOf('cold_tone');
    const real = await claimedCase(template.seed);
    const canary = await claimedCase(template.seed, template.defect);
    // A provider model that happened to investigate and answer the same way.
    const sameAnswer = canaryModelsOf(template, {
      redactorModelId: HAIKU_MODEL,
      agentModelId: SONNET_MODEL,
      pacing: SCRIPT_PACING,
    });
    await runCase(
      {
        ...depsFor([]),
        models: (modelId) =>
          modelId === HAIKU_MODEL ? sameAnswer.redactor : sameAnswer.agent,
      },
      real,
    );
    await runCase(depsFor([]), canary);

    const reads = {
      db,
      core: createCoreClient({ baseUrl: coreUrl, readKey: READ_KEY, fetch }),
    };
    const realDetail = await caseDetailOf(reads, real.caseId);
    const canaryDetail = await caseDetailOf(reads, canary.caseId);
    expect(JSON.stringify(canaryDetail)).not.toMatch(/canary/i);
    expect(new Set(keyPathsOf(canaryDetail))).toEqual(
      new Set(keyPathsOf(realDetail)),
    );
    const trailOf = (caseId: string) =>
      owner<{ actor: string; event: string }[]>`
        select actor, event from audit_log
        where ref = ${caseId} or ref in (select id from proposed_actions where case_id = ${caseId})
        order by at, event`;
    expect(await trailOf(canary.caseId)).toEqual(await trailOf(real.caseId));
  });
});
