import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';

import {
  CustomerRecordSchema,
  SearchPoliciesInputSchema,
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
import { seededRandom, seededRandomAfter } from '../../test/seeded-random.js';
import { HAIKU_MODEL, SONNET_MODEL } from '../agent/core/prices.js';
import type { Claim } from '../agent/core/queue.js';
import {
  runCase,
  type RunCaseConfig,
  type RunCaseDeps,
} from '../agent/core/run-case.js';
import { connectCaseTools } from '../agent/core/tools.js';
import { POLICY_SEARCH_TOOL } from '../agent/core/validate/evidence.js';
import { reviewTierOf } from '../cases/review-tier.js';
import { caseDetailOf } from '../console/read-model.js';
import type { Database } from '../database/index.js';
import * as schema from '../database/schema.js';
import { injectionSignal } from '../guard/prompt-guard.js';
import { seedPolicies } from '../retrieval/corpus-write.js';
import { POLICIES_DIR, loadManifest } from '../retrieval/ingest.js';
import { createRetrieval, policyCatalog } from '../retrieval/search.js';
import {
  canaryModelsOf,
  investigationOf,
  resolutionOf,
  type ScriptPacing,
} from './script.js';
import {
  CANARY_TEMPLATES,
  canaryTemplateOf,
  type CanaryTemplate,
} from './templates.js';

const DATA_DIR = resolve(import.meta.dirname, '../../../../data');
const READ_KEY = 'test-core-read-key';
const CASE_TOKEN_KEY = 'test-case-token-key-with-at-least-32-bytes';
const AUDIENCE = 'http://mcp.internal/mcp';
const RUN_TIMEOUT_MS = 180_000;
const LEASE_MARGIN_MS = 30_000;
const NO_BUDGET_LIMIT = 1e9;
const NO_REPAIR_DRAW = 0.99;
const REPAIR_DRAW = 0;
const SCRIPT_SEED = 11;
const MEASURES = [
  'input_tokens',
  'output_tokens',
  'cached_input_tokens',
  'cost_usd',
  'latency_ms',
  'provider_request_id',
] as const;

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

function depsFor(
  providerCalls: string[],
  scriptPacing: ScriptPacing = pacedScript(NO_REPAIR_DRAW),
): RunCaseDeps {
  const config: RunCaseConfig = {
    mode: 'on',
    variant: 'A',
    modelId: SONNET_MODEL,
    redactorModelId: HAIKU_MODEL,
    runTimeoutMs: RUN_TIMEOUT_MS,
    budget: { costUsd: NO_BUDGET_LIMIT, inputTokens: NO_BUDGET_LIMIT },
    mcpUrl,
    mcpAudience: AUDIENCE,
    caseTokenKey: CASE_TOKEN_KEY,
  };
  return {
    db,
    config,
    models: (modelId) => {
      providerCalls.push(modelId);
      throw new Error('the provider model was reached');
    },
    canaryModels: (canary) =>
      canaryModelsOf(canaryTemplateOf(canary), {
        ...config,
        pacing: scriptPacing,
      }),
    retrieval: createRetrieval(db, policyCatalog(loadManifest(POLICIES_DIR))),
    scanInjection: injectionSignal,
    connectTools: connectCaseTools,
    clock: () => Date.now(),
    random: () => 0.5,
    log: () => undefined,
  };
}

// The first draw decides whether the script repairs; the rest stay seeded so
// parallel tool calls get distinct ids.
const pacedScript = (firstDraw: number): ScriptPacing => ({
  random: seededRandomAfter(firstDraw, SCRIPT_SEED),
  sleep: () => Promise.resolve(),
});

// Worded as the template's last phrasing, so replay does not hinge on the first;
// masked as the webhook stores it.
async function claimedCase(
  { defect, seed }: CanaryTemplate,
  canary = true,
): Promise<Claim> {
  const caseId = `case_cr${++sequence}`;
  const claimToken = randomUUID();
  await insertCase(owner, caseId, seed.customerId);
  await owner`
    update cases set status = 'investigating', text_masked = ${maskPii(seed.texts.at(-1)!)},
      claim_token = ${claimToken}, attempts = 1,
      locked_until = ${new Date(Date.now() + RUN_TIMEOUT_MS + LEASE_MARGIN_MS)}
    where id = ${caseId}`;
  if (canary) {
    await owner`insert into canary_cases (case_id, defect) values (${caseId}, ${defect})`;
  }
  return { caseId, claimToken, attempt: 1 };
}

interface StepRow {
  kind: string;
  name: string;
  finish_reason: string | null;
  output_masked: unknown;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_input_tokens: number | null;
  cost_usd: string | null;
  latency_ms: number | null;
  provider_request_id: string | null;
}

const coreReads = () =>
  createCoreClient({ baseUrl: coreUrl, readKey: READ_KEY, fetch });

const stepsOf = async (caseId: string): Promise<StepRow[]> =>
  owner<StepRow[]>`
    select s.kind, s.name, s.finish_reason, s.output_masked, s.input_tokens,
      s.output_tokens, s.cached_input_tokens, s.cost_usd, s.latency_ms,
      s.provider_request_id
    from run_steps s join agent_runs a on a.id = s.run_id
    where a.case_id = ${caseId} order by s.idx`;

// Hand-written: evals/results keeps run totals only, so the shape comes from the
// harness's step records and the provider's usage mapping (10 rows, as 18 of
// each variant's 52 runs in REAL_RUNS_FILE).
const MEASURED_TOOL = MEASURES.filter((measure) => measure !== 'latency_ms');
const REAL_RUN_ROWS = [
  { kind: 'guard', finish_reason: null, nulls: ['provider_request_id'] },
  { kind: 'guard', finish_reason: null, nulls: [...MEASURES] },
  { kind: 'llm', finish_reason: 'tool-calls', nulls: [] },
  { kind: 'tool', finish_reason: null, nulls: MEASURED_TOOL },
  { kind: 'tool', finish_reason: null, nulls: MEASURED_TOOL },
  { kind: 'llm', finish_reason: 'tool-calls', nulls: [] },
  { kind: 'tool', finish_reason: null, nulls: MEASURED_TOOL },
  { kind: 'retrieval', finish_reason: null, nulls: MEASURED_TOOL },
  { kind: 'llm', finish_reason: 'stop', nulls: [] },
  { kind: 'validation', finish_reason: null, nulls: [...MEASURES] },
];

const shapeOf = (row: StepRow) => ({
  kind: row.kind,
  finish_reason: row.finish_reason,
  nulls: MEASURES.filter((measure) => row[measure] === null),
});

const validationsOf = (steps: readonly StepRow[]) =>
  steps
    .filter(({ kind }) => kind === 'validation')
    .map(({ output_masked }) => output_masked);

describe('a canary through the real harness (02 G3, G5)', () => {
  it.each(CANARY_TEMPLATES)(
    '$defect ($seed.customerId) investigates with real tools and lands its seed proposal, never on the provider',
    async (template) => {
      const { seed } = template;
      const claim = await claimedCase(template);
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
        text_redacted: maskPii(seed.texts.at(-1)!),
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
      expect(resolution!.citations).toEqual(resolutionOf(seed).citations);
      const steps = await stepsOf(caseId);
      expect(steps.slice(0, 2).map(({ name }) => name)).toEqual([
        'redaction',
        'injection_scan',
      ]);
      expect(
        steps
          .filter(({ kind }) => kind === 'tool' || kind === 'retrieval')
          .map(({ name }) => name),
      ).toEqual(
        investigationOf(seed, seededRandom(SCRIPT_SEED)).flatMap(({ calls }) =>
          calls.map(({ tool }) => tool),
        ),
      );
      // The stored output masks the digits of a long page, so ask the core itself.
      const page = await coreReads().transactions(
        seed.customerId,
        new URLSearchParams(
          Object.entries(seed.listFilter).map(
            ([key, value]): [string, string] => [key, String(value)],
          ),
        ),
      );
      const listed = page?.items.map(({ id }) => id) ?? [];
      for (const { transaction_id } of seed.lookups) {
        expect(listed).toContain(transaction_id);
      }
      expect(validationsOf(steps)).toEqual([{ outcome: 'passed', codes: [] }]);
    },
  );

  it.each(CANARY_TEMPLATES)(
    '$defect ($seed.customerId) answers a drawn run first with a misread figure the validator sends back, then lands the same proposal',
    async (template) => {
      const { seed } = template;
      const claim = await claimedCase(template);
      expect(
        await runCase(depsFor([], pacedScript(REPAIR_DRAW)), claim),
      ).toEqual({ kind: 'persisted', runStatus: 'succeeded' });
      const steps = await stepsOf(claim.caseId);
      expect(validationsOf(steps)).toEqual([
        { outcome: 'failed', codes: ['UNGROUNDED_NUMBER'] },
        { outcome: 'passed', codes: [] },
      ]);
      expect(
        steps
          .filter(({ kind }) => kind === 'llm')
          .map(({ finish_reason }) => finish_reason),
      ).toEqual(['tool-calls', 'tool-calls', 'stop', 'stop']);
      const [proposal] = await owner<
        { agent_type: string; agent_params: unknown }[]
      >`
        select agent_type, agent_params from proposed_actions where case_id = ${claim.caseId}`;
      expect(proposal).toMatchObject({
        agent_type: seed.action.type,
        agent_params: { transaction_ids: seed.action.transaction_ids },
      });
    },
  );

  it.each(CANARY_TEMPLATES)(
    '$defect ($seed.customerId) finds every chunk it cites with any of its search phrases',
    async ({ seed }) => {
      const retrieval = createRetrieval(
        db,
        policyCatalog(loadManifest(POLICIES_DIR)),
      );
      const [, lookups] = investigationOf(seed, seededRandom(SCRIPT_SEED));
      const searches = lookups!.calls.filter(
        ({ tool }) => tool === POLICY_SEARCH_TOOL,
      );
      for (const [index, { citation, queries }] of seed.policies.entries()) {
        const input = SearchPoliciesInputSchema.parse(searches[index]!.input);
        for (const query of queries) {
          const chunks = await retrieval.search({ ...input, query });
          expect(
            chunks.map(({ chunk_id }) => chunk_id),
            query,
          ).toContain(citation.chunk_id);
        }
      }
    },
  );

  it("stores its steps with the kinds, finish reasons and nulls of a real run's", async () => {
    const template = CANARY_TEMPLATES.find(
      ({ seed }) =>
        seed.lookups.length === 1 &&
        seed.policies.length === 1 &&
        seed.lookups[0]!.tool === 'get_card_authorization',
    )!;
    const claim = await claimedCase(template);
    await runCase(depsFor([]), claim);
    const steps = await stepsOf(claim.caseId);
    expect(steps.map(shapeOf)).toEqual(REAL_RUN_ROWS);
    for (const { cached_input_tokens } of steps) {
      expect([null, 0]).toContain(cached_input_tokens);
    }
  });

  it('reads in the console exactly like a real case that ran the same investigation', async () => {
    const template = CANARY_TEMPLATES.find(
      ({ defect }) => defect === 'cold_tone',
    )!;
    const real = await claimedCase(template, false);
    const canary = await claimedCase(template);
    // A provider model that happened to investigate and answer the same way.
    const sameAnswer = canaryModelsOf(template, {
      ...depsFor([]).config,
      pacing: pacedScript(NO_REPAIR_DRAW),
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

    const reads = { db, core: coreReads() };
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
