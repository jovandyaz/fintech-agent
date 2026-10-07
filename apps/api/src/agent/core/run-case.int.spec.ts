import { randomUUID } from 'node:crypto';

import { MockLanguageModelV4 } from 'ai/test';
import { drizzle } from 'drizzle-orm/postgres-js';
import { decodeJwt } from 'jose';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  investigation,
  mcpOk,
  mcpToolsOf,
} from '../../../test/agent-fixtures.js';
import {
  CONTAINER_START_MS,
  insertCase,
  startTestDatabase,
  type TestDatabase,
} from '../../../test/database.js';
import {
  SPEND_LIMIT_400_BODY,
  SPEND_LIMIT_429_BODY,
  callError,
  inOrder,
  objectResponse,
  toolCallResponse,
  tooManyRequests,
  type GenerateResult,
} from '../../../test/mock-model.js';
import {
  RECEIVED_AT,
  SPEI_TX,
  listed,
  policyChunk,
  resolutionOf,
  speiRow,
  speiStatus,
} from '../../../test/validator-fixtures.js';
import type { Database } from '../../database/index.js';
import * as schema from '../../database/schema.js';
import { HAIKU_MODEL, SONNET_MODEL } from './prices.js';
import { MAX_ATTEMPTS, type Claim } from './queue.js';
import { runCase, type RunCaseConfig, type RunCaseDeps } from './run-case.js';
import type { CaseTools } from './tools.js';

const T0 = new Date('2026-10-07T15:01:00Z');
const RUN_TIMEOUT_MS = 180_000;
const HUGE = 1e9;
const MCP_URL = 'http://mcp.test/mcp';
const CASE_TEXT =
  'Me llamo Ana Pelusa y no reconozco un cargo de AMZN MKTP MX.';
const MIDDLE = () => 0.5;
const ONE_CALL_AND_TWO_SDK_RETRIES = 3;
const SECOND_MS = 1000;
const TOKEN_MARGIN_MS = 60_000;
const EIGHT_DIGITS = /\d{8,}/;
const PHONE_ERROR = () => new Error('tel 5512345678');
// Just above MIN_MODEL_CALL_MS, so one model call is made and the attempt
// ends while the SDK waits to retry.
const SHORTEST_ATTEMPT_MS = 5_200;
const SLOW_TEST_MS = 15_000;
const NO_WAIT = { 'retry-after-ms': '0' };

let testDb: TestDatabase;
let owner: postgres.Sql;
let apiSql: postgres.Sql;
let db: Database;
let sequence = 0;

const CONFIG: RunCaseConfig = {
  mode: 'on',
  variant: 'A',
  modelId: SONNET_MODEL,
  redactorModelId: HAIKU_MODEL,
  runTimeoutMs: RUN_TIMEOUT_MS,
  budget: { costUsd: HUGE, inputTokens: HUGE },
  mcpUrl: MCP_URL,
  mcpAudience: MCP_URL,
  caseTokenKey: 'k'.repeat(32),
};

const redactor = (spans: string[] = ['Pelusa']) =>
  inOrder(() => objectResponse({ spans }));
const answering = (...responses: (() => GenerateResult)[]) =>
  inOrder(...investigation, ...responses);
const resolved = () => answering(() => objectResponse(resolutionOf()));
const refusing = (error: () => Error) =>
  new MockLanguageModelV4({ doGenerate: () => Promise.reject(error()) });

interface Harness {
  deps: RunCaseDeps;
  agent: MockLanguageModelV4;
  connections: { token: string; runRowExisted: boolean }[];
  closed: () => number;
  logs: Record<string, unknown>[];
}

function harness(
  agent: MockLanguageModelV4,
  overrides: Partial<RunCaseDeps> = {},
  redactorModel: MockLanguageModelV4 = redactor(),
): Harness {
  const connections: Harness['connections'] = [];
  const logs: Record<string, unknown>[] = [];
  let closed = 0;
  const models = (modelId: string): MockLanguageModelV4 =>
    modelId === HAIKU_MODEL ? redactorModel : agent;
  return {
    agent,
    connections,
    logs,
    closed: () => closed,
    deps: {
      db,
      config: CONFIG,
      models,
      retrieval: {
        catalog: [{ doc_id: 'pol-04', title: 'Cargos no reconocidos' }],
        search: () => Promise.resolve([policyChunk()]),
      },
      scanInjection: () => false,
      connectTools: async ({ token }): Promise<CaseTools> => {
        const runId = String(decodeJwt(token).run_id);
        const [row] = await owner`select 1 from agent_runs where id = ${runId}`;
        connections.push({ token, runRowExisted: row !== undefined });
        return {
          tools: mcpToolsOf(),
          close: () => {
            closed += 1;
            return Promise.resolve();
          },
        };
      },
      clock: () => T0.getTime(),
      random: MIDDLE,
      log: (event) => logs.push(event),
      ...overrides,
    },
  };
}

const customerOf = (claim: Claim): string =>
  claim.caseId.replace('case_', 'cus_');

async function claimed(attempt = 1): Promise<Claim> {
  const caseId = `case_rc${++sequence}`;
  const claim = { caseId, claimToken: randomUUID(), attempt };
  await insertCase(owner, caseId, customerOf(claim));
  await owner`
    update cases set status = 'investigating', received_at = ${RECEIVED_AT},
      text_masked = ${CASE_TEXT}, claim_token = ${claim.claimToken},
      locked_until = ${new Date(T0.getTime() + RUN_TIMEOUT_MS + 30_000)}, attempts = ${attempt}
    where id = ${caseId}`;
  return claim;
}

const caseOf = async (id: string) => {
  const [row] = await owner<
    {
      status: string;
      text_redacted: string | null;
      flags: string[];
      claim_token: string | null;
      next_attempt_at: Date;
      attempts: number;
    }[]
  >`
    select status, text_redacted, flags, claim_token, next_attempt_at, attempts
    from cases where id = ${id}`;
  return row!;
};
const runsOf = (caseId: string) => owner<
  {
    id: string;
    status: string;
    stop_reason: string | null;
    error_code: string | null;
    variant: string;
    model: string;
    prompt_version: string;
    started_at: Date;
    cost_usd: string;
  }[]
>`
  select id, status, stop_reason, error_code, variant, model, prompt_version,
    started_at, cost_usd
  from agent_runs where case_id = ${caseId}`;
const stepsOf = (runId: string) =>
  owner<
    { kind: string; name: string; output_masked: unknown; cost_usd: string }[]
  >`select kind, name, output_masked, cost_usd from run_steps where run_id = ${runId} order by idx`;

beforeAll(async () => {
  testDb = await startTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 2 });
  apiSql = postgres(testDb.urlFor('copilot_api'), { max: 4 });
  db = drizzle({ client: apiSql, schema });
}, CONTAINER_START_MS);

afterAll(async () => {
  await apiSql?.end();
  await owner?.end();
  await testDb?.stop();
});

describe('runCase (01 §Agent pipeline)', () => {
  it('investigates a claimed case into needs_review with its intake steps first', async () => {
    const claim = await claimed();
    const h = harness(resolved());
    expect(await runCase(h.deps, claim)).toEqual({
      kind: 'persisted',
      runStatus: 'succeeded',
    });
    const kase = await caseOf(claim.caseId);
    expect(kase.status).toBe('needs_review');
    expect(kase.text_redacted).toBe(
      'Me llamo Ana [dato] y no reconozco un cargo de AMZN MKTP MX.',
    );
    const [run] = await runsOf(claim.caseId);
    expect(run).toMatchObject({
      status: 'succeeded',
      variant: 'A',
      model: SONNET_MODEL,
      started_at: T0,
    });
    expect(run!.prompt_version).toMatch(/^[0-9a-f]{16}$/);
    const steps = await stepsOf(run!.id);
    expect(steps.slice(0, 2)).toMatchObject([
      {
        kind: 'guard',
        name: 'redaction',
        output_masked: { outcome: 'passed' },
      },
      {
        kind: 'guard',
        name: 'injection_scan',
        output_masked: { outcome: 'passed' },
      },
    ]);
    expect(Number(steps[0]!.cost_usd)).toBeGreaterThan(0);
    const stepTotal = steps.reduce(
      (total, { cost_usd }) => total + Number(cost_usd ?? 0),
      0,
    );
    expect(Number(run!.cost_usd)).toBeCloseTo(stepTotal, 6);
    expect(steps.some(({ kind }) => kind === 'llm')).toBe(true);
  });

  it('mints the case token for the case customer, after the run row commit, from the attempt start', async () => {
    const claim = await claimed();
    let ticks = 0;
    const h = harness(resolved(), {
      clock: () => T0.getTime() + SECOND_MS * ticks++,
    });
    await runCase(h.deps, claim);
    expect(h.connections).toEqual([
      expect.objectContaining({ runRowExisted: true }),
    ]);
    const [run] = await runsOf(claim.caseId);
    expect(decodeJwt(h.connections[0]!.token)).toMatchObject({
      run_id: run!.id,
      case_id: claim.caseId,
      sub: customerOf(claim),
      iat: T0.getTime() / SECOND_MS,
      exp: (T0.getTime() + RUN_TIMEOUT_MS + TOKEN_MARGIN_MS) / SECOND_MS,
    });
    expect(h.closed()).toBe(1);
  });

  it('does not wait on an MCP client that never finishes closing', async () => {
    const claim = await claimed();
    const h = harness(resolved(), {
      connectTools: () =>
        Promise.resolve({
          tools: mcpToolsOf(),
          close: () => new Promise<void>(() => undefined),
        }),
    });
    expect(await runCase(h.deps, claim)).toMatchObject({ kind: 'persisted' });
  });

  it('gives the agent the redacted text, never the masked one', async () => {
    const claim = await claimed();
    const h = harness(resolved());
    await runCase(h.deps, claim);
    const prompt = JSON.stringify(h.agent.doGenerateCalls[0]!.prompt);
    expect(prompt).toContain('[dato]');
    expect(prompt).not.toContain('Pelusa');
  });

  it('flags the intake injection signal on the case', async () => {
    const claim = await claimed();
    const h = harness(resolved(), { scanInjection: () => true });
    await runCase(h.deps, claim);
    expect((await caseOf(claim.caseId)).flags).toContain('injection_signal');
  });

  it('continues on the masked text with a degraded step when the redactor fails', async () => {
    const claim = await claimed();
    const h = harness(
      resolved(),
      {},
      refusing(() => callError(500, '', NO_WAIT)),
    );
    expect(await runCase(h.deps, claim)).toMatchObject({ kind: 'persisted' });
    expect((await caseOf(claim.caseId)).text_redacted).toBe(CASE_TEXT);
    const [run] = await runsOf(claim.caseId);
    expect((await stepsOf(run!.id))[0]).toMatchObject({
      name: 'redaction',
      output_masked: { outcome: 'degraded' },
    });
  });
});

describe('runCase cross-customer lookup (02 G4, G5)', () => {
  const escalation = () =>
    objectResponse(
      resolutionOf({
        draft_reply: 'Hola {{nombre}}, revisamos tu caso con folio {{folio}}.',
        evidence: [],
        proposed_action: {
          type: 'escalate_fraud',
          transaction_ids: [],
          reason_code: 'suspected_card_fraud',
          justification: 'Consulta de otro cliente durante la corrida.',
        },
      }),
    );

  it('grounds escalate_fraud on a lookup the MCP server recorded for this run', async () => {
    const claim = await claimed();
    const h = harness(answering(escalation, escalation), {
      connectTools: async ({ token }) => {
        const runId = String(decodeJwt(token).run_id);
        await owner`
          insert into security_events (kind, case_id, run_id, ref_masked)
          values ('cross_customer_lookup', ${claim.caseId}, ${runId}, 'tx_foreign')`;
        return { tools: mcpToolsOf(), close: () => Promise.resolve() };
      },
    });
    expect(await runCase(h.deps, claim)).toEqual({
      kind: 'persisted',
      runStatus: 'succeeded',
    });
  });

  it('does not ground escalate_fraud on a lookup an earlier attempt recorded', async () => {
    const claim = await claimed();
    const earlier = `run_before_${claim.caseId}`;
    await owner`
      insert into agent_runs (id, case_id, variant, model, prompt_version, status)
      values (${earlier}, ${claim.caseId}, 'A', 'm', 'p', 'failed')`;
    await owner`
      insert into security_events (kind, case_id, run_id, ref_masked)
      values ('cross_customer_lookup', ${claim.caseId}, ${earlier}, 'tx_foreign')`;
    const h = harness(answering(escalation, escalation));
    expect(await runCase(h.deps, claim)).toEqual({
      kind: 'persisted',
      runStatus: 'fallback',
    });
  });

  it('falls back on escalate_fraud when no lookup was recorded', async () => {
    const claim = await claimed();
    const h = harness(answering(escalation, escalation));
    expect(await runCase(h.deps, claim)).toEqual({
      kind: 'persisted',
      runStatus: 'fallback',
    });
  });
});

describe('runCase corpus state rules (02 G5 POLICY_DATA_CONFLICT)', () => {
  it('runs every non-quarantined rule of the corpus against what the run saw', async () => {
    const rule = (id: string) => ({
      id,
      applies_to: { type: 'spei_out', status: 'returned' },
      requires: { field: 'reversal_credit_id', not_null: true },
    });
    await owner`
      insert into policy_chunks (id, doc_id, section, content, state_rules, content_hash, quarantined)
      values ('chunk_rule', 'pol-02', 'Devoluciones', 'x', ${owner.json([rule('return_credit_same_day')])}, 'h1', false),
             ('chunk_bad', 'pol-09', 'Anexo', 'x', ${owner.json([rule('quarantined_rule')])}, 'h2', true)`;
    const claim = await claimed();
    const returned = () => mcpOk(speiStatus({ status: 'returned' }));
    const abstaining = resolutionOf({
      category: 'spei_outgoing_not_received',
      draft_reply: 'Revisamos tu caso con folio {{folio}}.',
      citations: [],
      abstained: true,
      evidence: [],
      proposed_action: {
        type: 'none',
        transaction_ids: [],
        reason_code: 'insufficient_information',
        justification: 'Sin información suficiente.',
      },
    });
    const h = harness(
      inOrder(
        () => toolCallResponse('list_transactions', {}),
        () => toolCallResponse('get_spei_status', { transaction_id: SPEI_TX }),
        () => objectResponse(abstaining),
      ),
      {
        connectTools: () =>
          Promise.resolve({
            tools: mcpToolsOf({
              list_transactions: () =>
                mcpOk(listed(speiRow({ status: 'returned' })).output),
              get_spei_status: returned,
            }),
            close: () => Promise.resolve(),
          }),
      },
    );
    try {
      await runCase(h.deps, claim);
    } finally {
      await owner`delete from policy_chunks where id in ('chunk_rule', 'chunk_bad')`;
    }
    expect((await caseOf(claim.caseId)).flags).toContain(
      'policy_data_conflict',
    );
    const [proposal] = await owner<{ type: string; justification: string }[]>`
      select type, justification from proposed_actions where case_id = ${claim.caseId}`;
    expect(proposal!.type).toBe('none');
    expect(proposal!.justification).toContain('return_credit_same_day');
    expect(proposal!.justification).not.toContain('quarantined_rule');
  });
});

describe('runCase failure handling (02 Agent loop, 01 §Failure handling)', () => {
  it('with AGENT_MODE=off calls no model and proposes none as agent_disabled', async () => {
    const claim = await claimed();
    const h = harness(
      refusing(() => new Error('no model call expected')),
      {
        config: { ...CONFIG, mode: 'off' },
        scanInjection: () => true,
      },
    );
    expect(await runCase(h.deps, claim)).toEqual({
      kind: 'persisted',
      runStatus: 'fallback',
    });
    expect(h.agent.doGenerateCalls).toHaveLength(0);
    expect(h.connections).toHaveLength(0);
    const [run] = await runsOf(claim.caseId);
    expect(run).toMatchObject({
      status: 'fallback',
      stop_reason: 'agent_disabled',
    });
    expect(await stepsOf(run!.id)).toMatchObject([
      {
        kind: 'guard',
        name: 'injection_scan',
        output_masked: { outcome: 'flagged' },
      },
    ]);
    expect(await caseOf(claim.caseId)).toMatchObject({
      status: 'needs_review',
      flags: ['injection_signal', 'fallback'],
      text_redacted: CASE_TEXT,
    });
  });

  it('ends at once with no_api_key and no retry when no key is configured', async () => {
    const claim = await claimed();
    const h = harness(resolved(), { models: null });
    expect(await runCase(h.deps, claim)).toEqual({
      kind: 'failed',
      errorCode: 'no_api_key',
      caseStatus: 'failed',
      providerOutage: false,
    });
    expect(h.connections).toHaveLength(0);
    expect(await runsOf(claim.caseId)).toMatchObject([
      { status: 'failed', stop_reason: 'error', error_code: 'no_api_key' },
    ]);
    expect(await caseOf(claim.caseId)).toMatchObject({
      status: 'failed',
      claim_token: null,
      text_redacted: CASE_TEXT,
    });
  });

  it('retries a 429 in the SDK, then queues the case again with backoff', async () => {
    const claim = await claimed();
    const agent = refusing(tooManyRequests);
    const h = harness(agent);
    expect(await runCase(h.deps, claim)).toEqual({
      kind: 'failed',
      errorCode: 'provider_unavailable',
      caseStatus: 'queued',
      providerOutage: true,
    });
    expect(agent.doGenerateCalls).toHaveLength(ONE_CALL_AND_TWO_SDK_RETRIES);
    const kase = await caseOf(claim.caseId);
    expect(kase.status).toBe('queued');
    expect(kase.next_attempt_at.getTime()).toBeGreaterThan(T0.getTime());
    expect(await runsOf(claim.caseId)).toMatchObject([
      { status: 'failed', error_code: 'provider_unavailable' },
    ]);
    expect(h.closed()).toBe(1);
  });

  it('fails the case after its last attempt', async () => {
    const claim = await claimed(MAX_ATTEMPTS);
    const h = harness(refusing(tooManyRequests));
    expect(await runCase(h.deps, claim)).toMatchObject({
      caseStatus: 'failed',
    });
    expect((await caseOf(claim.caseId)).status).toBe('failed');
  });

  it('treats a step timeout as retryable', async () => {
    const claim = await claimed();
    const h = harness(
      refusing(() => new DOMException('Step timeout', 'TimeoutError')),
    );
    expect(await runCase(h.deps, claim)).toMatchObject({
      errorCode: 'provider_unavailable',
      caseStatus: 'queued',
      providerOutage: false,
    });
  });

  it.each([
    ['429', SPEND_LIMIT_429_BODY, 429],
    ['400', SPEND_LIMIT_400_BODY, 400],
  ])(
    'ends a spend-limit %s as provider_spend_limit, with no job retry',
    async (_, body, status) => {
      const claim = await claimed();
      const h = harness(refusing(() => callError(status, body, NO_WAIT)));
      expect(await runCase(h.deps, claim)).toEqual({
        kind: 'failed',
        errorCode: 'provider_spend_limit',
        caseStatus: 'failed',
        providerOutage: false,
      });
    },
  );

  it('keeps the steps and cost spent before a provider error', async () => {
    const claim = await claimed();
    let call = 0;
    const agent = new MockLanguageModelV4({
      doGenerate: () => {
        call += 1;
        return call === 1
          ? Promise.resolve(investigation[0]!())
          : Promise.reject(tooManyRequests());
      },
    });
    await runCase(harness(agent).deps, claim);
    const [run] = await runsOf(claim.caseId);
    const steps = await stepsOf(run!.id);
    expect(steps.map(({ kind }) => kind)).toEqual([
      'guard',
      'guard',
      'llm',
      'tool',
    ]);
    expect(Number(run!.cost_usd)).toBeGreaterThan(0);
  });

  it('queues the case again as mcp_unavailable when the MCP server cannot be reached', async () => {
    const claim = await claimed();
    const h = harness(resolved(), {
      connectTools: () => Promise.reject(new Error('ECONNREFUSED')),
    });
    expect(await runCase(h.deps, claim)).toEqual({
      kind: 'failed',
      errorCode: 'mcp_unavailable',
      caseStatus: 'queued',
      providerOutage: false,
    });
    expect(h.agent.doGenerateCalls).toHaveLength(0);
  });

  it('logs an MCP connection error masked', async () => {
    const claim = await claimed();
    const h = harness(resolved(), {
      connectTools: () => Promise.reject(PHONE_ERROR()),
    });
    expect(await runCase(h.deps, claim)).toMatchObject({
      errorCode: 'mcp_unavailable',
    });
    expect(h.logs).toHaveLength(1);
    expect(JSON.stringify(h.logs)).not.toMatch(EIGHT_DIGITS);
  });

  it('retries an error of its own as internal_error and logs it masked', async () => {
    const claim = await claimed();
    const h = harness(resolved(), {
      scanInjection: () => {
        throw PHONE_ERROR();
      },
    });
    expect(await runCase(h.deps, claim)).toEqual({
      kind: 'failed',
      errorCode: 'internal_error',
      caseStatus: 'queued',
      providerOutage: false,
    });
    expect(h.logs).toHaveLength(1);
    expect(JSON.stringify(h.logs)).not.toMatch(EIGHT_DIGITS);
  });

  it(
    'reads a timeout during the SDK retry wait as the 429 that caused it',
    async () => {
      const claim = await claimed();
      const slow = { 'retry-after-ms': '30000' };
      const h = harness(
        refusing(() => callError(429, '', slow)),
        {
          config: { ...CONFIG, runTimeoutMs: SHORTEST_ATTEMPT_MS },
        },
      );
      expect(await runCase(h.deps, claim)).toEqual({
        kind: 'failed',
        errorCode: 'provider_unavailable',
        caseStatus: 'queued',
        providerOutage: true,
      });
    },
    SLOW_TEST_MS,
  );

  it('writes nothing more once another worker holds the case', async () => {
    const claim = await claimed();
    const h = harness(resolved(), {
      connectTools: async () => {
        await owner`
          update cases set claim_token = ${randomUUID()} where id = ${claim.caseId}`;
        return { tools: mcpToolsOf(), close: () => Promise.resolve() };
      },
    });
    expect(await runCase(h.deps, claim)).toEqual({ kind: 'stale' });
    expect(h.logs).toEqual([]);
    const [run] = await runsOf(claim.caseId);
    expect(run).toMatchObject({ status: 'running' });
    expect(await stepsOf(run!.id)).toEqual([]);
  });

  const steal = (claim: Claim) => owner`
    update cases set claim_token = ${randomUUID()} where id = ${claim.caseId}`;

  it('starts no run for a claim already lost', async () => {
    const claim = await claimed();
    await steal(claim);
    expect(await runCase(harness(resolved()).deps, claim)).toEqual({
      kind: 'stale',
    });
    expect(await runsOf(claim.caseId)).toEqual([]);
  });

  it('stores no redacted text for a claim lost during the redaction', async () => {
    const claim = await claimed();
    const stealing = new MockLanguageModelV4({
      doGenerate: async () => {
        await steal(claim);
        return objectResponse({ spans: ['Pelusa'] });
      },
    });
    expect(
      await runCase(harness(resolved(), {}, stealing).deps, claim),
    ).toEqual({ kind: 'stale' });
    expect((await caseOf(claim.caseId)).text_redacted).toBeNull();
  });

  it('records no failure for a claim lost before a provider error', async () => {
    const claim = await claimed();
    const before = await caseOf(claim.caseId);
    const h = harness(refusing(tooManyRequests), {
      connectTools: async () => {
        await steal(claim);
        return { tools: mcpToolsOf(), close: () => Promise.resolve() };
      },
    });
    expect(await runCase(h.deps, claim)).toEqual({ kind: 'stale' });
    const kase = await caseOf(claim.caseId);
    expect(kase).toMatchObject({
      status: 'investigating',
      attempts: before.attempts,
      next_attempt_at: before.next_attempt_at,
    });
    const [run] = await runsOf(claim.caseId);
    expect(run).toMatchObject({ status: 'running', error_code: null });
    expect(await stepsOf(run!.id)).toEqual([]);
  });
});
