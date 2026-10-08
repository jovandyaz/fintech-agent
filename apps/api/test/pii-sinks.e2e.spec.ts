import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { maskPii, type CardTx, type Customer } from '@fintech-agent/contracts';
import { createCoreMock, type CoreMock } from '@fintech-agent/core-mock';
import { createMcpApp, type McpApp } from '../../mcp/src/app.js';
import { MockLanguageModelV4 } from 'ai/test';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Database } from '../src/database/index.js';
import * as schema from '../src/database/schema.js';
import { HAIKU_MODEL, SONNET_MODEL } from '../src/agent/core/prices.js';
import { runCase, type RunCaseDeps } from '../src/agent/core/run-case.js';
import { connectCaseTools } from '../src/agent/core/tools.js';
import {
  CONTAINER_START_MS,
  insertCase,
  startTestDatabase,
  type TestDatabase,
} from './database.js';
import { inOrder, objectResponse, toolCallResponse } from './mock-model.js';
import { captureSpans, type CapturedSpans } from './spans.js';
import {
  RECEIVED_AT,
  policyChunk,
  resolutionOf,
} from './validator-fixtures.js';

const CUSTOMER_ID = 'cus_01';
const CASE_ID = 'case_pii01';
const TX = 'tx_pii01';
const READ_KEY = 'test-core-read-key';
const CASE_TOKEN_KEY = 'test-case-token-key-with-at-least-32-bytes';
const AUDIENCE = 'http://mcp.internal/mcp';
const RUN_TIMEOUT_MS = 180_000;
const LEASE_MARGIN_MS = 30_000;
const NO_BUDGET_LIMIT = 1e9;
const EXCEPTION_EVENT = 'exception';

// Every value 02 G6 says must never reach a log, a trace or the model.
const PLANTED = {
  clabe: '646180590988801788',
  pan: '4761343220832617',
  panSpaced: '4761 3432 2083 2617',
  phone: '5532732905',
  rfc: 'GOPA741222HKG',
  curp: 'GOPA741222MDFGHJP1',
  otp: '739104',
} as const;

const RAW_CASE_TEXT = [
  `Soy Ana, mi CLABE es ${PLANTED.clabe} y mi tarjeta ${PLANTED.panSpaced}.`,
  `Mi celular ${PLANTED.phone}, RFC ${PLANTED.rfc}, CURP ${PLANTED.curp}.`,
  `Me llegó el código de verificación ${PLANTED.otp} y no reconozco el cargo.`,
].join(' ');

const customer: Customer = {
  id: CUSTOMER_ID,
  first_name: 'Ana',
  last_names: 'Gómez Pérez',
  rfc: PLANTED.rfc,
  curp: PLANTED.curp,
  email: 'ana.gomez@example.com',
  phone: PLANTED.phone,
  clabe: PLANTED.clabe,
  card_pan: PLANTED.pan,
  card_status: 'active',
  kyc_level: 'N3',
  account_status: 'active',
};

const charge: CardTx = {
  id: TX,
  customer_id: CUSTOMER_ID,
  type: 'card_purchase',
  status: 'settled',
  amount: 899,
  created_at: '2026-10-03T22:10:00-06:00',
  merchant_descriptor: `PAYPAL *${PLANTED.pan}`,
  merchant_brand: 'Digital Goods Ltd',
  channel: 'card_not_present',
  auth_factors: 1,
  decline_reason: null,
};

// The model repeats what it should never have seen; Persist must mask it.
const echoingResolution = resolutionOf({
  evidence: [{ kind: 'card_auth', id: TX }],
  proposed_action: {
    type: 'open_dispute',
    transaction_ids: [TX],
    reason_code: 'unrecognized_charge',
    justification: `Cargo sin segundo factor; tel ${PLANTED.phone}.`,
  },
  reasoning_summary: `La clienta da su CLABE ${PLANTED.clabe} y tel ${PLANTED.phone}.`,
});

// maskJson may keep an epoch under a time key, but no scanned value carries
// one, so any run of eight or more digits fails.
const EIGHT_DIGITS = /\d{8,}/g;
const MIN_DIGITS = 8;

function unmaskedRuns(value: unknown): string[] {
  if (typeof value === 'string') return value.match(EIGHT_DIGITS) ?? [];
  if (typeof value === 'number') {
    return Number.isInteger(value) &&
      String(Math.abs(value)).length >= MIN_DIGITS
      ? [String(value)]
      : [];
  }
  if (value instanceof Date) return [];
  if (Array.isArray(value)) return value.flatMap(unmaskedRuns);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([name, item]) => [
      ...unmaskedRuns(name),
      ...unmaskedRuns(item),
    ]);
  }
  return [];
}

// A planted number regrouped ("55 3273 2905", "4761-3432-…") is still the
// full value: its digits may be split by up to three separators (02 G6 Step 3).
const SEPARATORS = '[^\\p{L}\\d]{0,3}';
const plantedPattern = (planted: string): RegExp =>
  /^\d+$/.test(planted)
    ? new RegExp([...planted].join(SEPARATORS), 'u')
    : new RegExp(planted);

// Not the JSON text: its escaped newline carries a letter, which would hide
// a number split across lines from the separator pattern.
function textsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(textsOf);
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    return Object.entries(value).flatMap(([name, item]) => [
      name,
      ...textsOf(item),
    ]);
  }
  return [];
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    }),
  );
}

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve) => server.close(() => resolve()));

let testDb: TestDatabase;
let owner: postgres.Sql;
let apiSql: postgres.Sql;
let db: Database;
let core: CoreMock;
let mcp: McpApp;
let mcpUrl: string;
const coreLogs: Record<string, unknown>[] = [];
const mcpLogs: Record<string, unknown>[] = [];

beforeAll(async () => {
  testDb = await startTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 2 });
  apiSql = postgres(testDb.urlFor('copilot_api'), { max: 4 });
  db = drizzle({ client: apiSql, schema });
  core = createCoreMock({
    customers: [customer],
    transactions: [charge],
    readKey: READ_KEY,
    executorKey: 'test-executor-key',
    databasePath: ':memory:',
    log: (line) => coreLogs.push(line),
  });
  mcp = createMcpApp({
    coreUrl: await listen(core.server),
    coreReadKey: READ_KEY,
    caseTokenKey: CASE_TOKEN_KEY,
    audience: AUDIENCE,
    securityEvents: { record: () => Promise.resolve() },
    log: (line) => mcpLogs.push(line),
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

interface Sinks {
  runSteps: readonly { name: string; output_masked: unknown }[];
  auditLog: readonly unknown[];
  persisted: readonly unknown[];
  logs: Record<string, unknown>[];
  spans: CapturedSpans;
  modelPrompts: unknown[];
}

async function runPlantedCase(): Promise<Sinks> {
  const claimToken = randomUUID();
  await insertCase(owner, CASE_ID, CUSTOMER_ID);
  await owner`
    update cases set status = 'investigating', received_at = ${RECEIVED_AT},
      text_masked = ${maskPii(RAW_CASE_TEXT)}, claim_token = ${claimToken},
      locked_until = ${new Date(Date.now() + RUN_TIMEOUT_MS + LEASE_MARGIN_MS)},
      attempts = 1
    where id = ${CASE_ID}`;

  // A failed call is the one path where @ai-sdk/otel writes free text on a
  // span with content off: the error message, as an exception event.
  const redactor = new MockLanguageModelV4({
    doGenerate: () =>
      Promise.reject(new Error(`proveedor caído, tel ${PLANTED.phone}`)),
  });
  const agent = inOrder(
    () => toolCallResponse('get_customer', {}),
    () => toolCallResponse('get_card_authorization', { transaction_id: TX }),
    () =>
      toolCallResponse('search_policies', {
        query: 'cargo no reconocido',
        k: 4,
      }),
    () => objectResponse(echoingResolution),
  );
  const logs: Record<string, unknown>[] = [];
  const spans = captureSpans();
  const deps: RunCaseDeps = {
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
    models: (modelId): MockLanguageModelV4 =>
      modelId === HAIKU_MODEL ? redactor : agent,
    canaryModels: () => {
      throw new Error('not a canary case');
    },
    retrieval: {
      catalog: [{ doc_id: 'pol-04', title: 'Cargos no reconocidos' }],
      search: () => Promise.resolve([policyChunk()]),
    },
    scanInjection: () => false,
    // A clean run logs no error, so a failure carrying a raw value is staged
    // to put the logger on the scanned path.
    connectTools: async (target) => {
      const tools = await connectCaseTools(target);
      return {
        tools: tools.tools,
        close: async () => {
          await tools.close();
          throw new Error(`cierre fallido, tel ${PLANTED.phone}`);
        },
      };
    },
    clock: () => Date.now(),
    random: () => 0.5,
    log: (event) => logs.push(event),
    telemetry: spans.telemetry,
  };

  expect(
    await runCase(deps, { caseId: CASE_ID, claimToken, attempt: 1 }),
  ).toEqual({ kind: 'persisted', runStatus: 'succeeded' });
  await vi.waitFor(() =>
    expect(logs.map(({ event }) => event)).toContain('mcp_close_failed'),
  );

  return {
    runSteps: await owner<
      {
        kind: string;
        name: string;
        input_masked: unknown;
        output_masked: unknown;
        finish_reason: string | null;
      }[]
    >`select kind, name, input_masked, output_masked, finish_reason from run_steps`,
    auditLog:
      await owner`select actor, event, ref, detail_masked, ip, user_agent from audit_log`,
    persisted: [
      ...(await owner`select text_masked, text_redacted, flags from cases`),
      ...(await owner`select category, draft_reply, citations, reasoning_summary from resolutions`),
      ...(await owner`select type, agent_type, params, agent_params, justification from proposed_actions`),
      ...(await owner`select status, stop_reason, error_code from agent_runs`),
    ],
    logs: [...logs, ...mcpLogs, ...coreLogs],
    spans,
    modelPrompts: [...redactor.doGenerateCalls, ...agent.doGenerateCalls].map(
      ({ prompt }) => prompt,
    ),
  };
}

describe('masking at sinks (02 G6), a case run end to end through the real MCP server', () => {
  let sinks: Sinks;

  beforeAll(async () => {
    sinks = await runPlantedCase();
  });

  it('reaches every sink, so the scans below are not vacuous', () => {
    expect(sinks.runSteps.length).toBeGreaterThan(0);
    expect(sinks.auditLog.length).toBeGreaterThan(0);
    expect(sinks.logs.length).toBeGreaterThan(0);
    expect(sinks.spans.spans().length).toBeGreaterThan(0);
    expect(JSON.stringify(sinks.runSteps)).toContain('get_card_authorization');
  });

  it('feeds the planted core data to the run, masked by the MCP server', () => {
    const customerStep = sinks.runSteps.find(
      ({ name }) => name === 'get_customer',
    );
    expect(JSON.stringify(customerStep?.output_masked)).toContain(
      `••••${PLANTED.clabe.slice(-4)}`,
    );
  });

  it('traces the agent call through runCase, not only the redactor', () => {
    expect(sinks.spans.spans().map(({ name }) => name)).toContain(
      'execute_tool get_card_authorization',
    );
  });

  it('puts a raw value on a span, which only the masking processor removes', () => {
    expect(
      sinks.spans
        .spans()
        .some((span) =>
          span.events.some(({ name }) => name === EXCEPTION_EVENT),
        ),
    ).toBe(true);
  });

  it.each([
    ['run_steps', () => sinks.runSteps],
    ['audit_log', () => sinks.auditLog],
    ['case, resolution, proposal and run rows', () => sinks.persisted],
    ['logger output of api, MCP and core-mock', () => sinks.logs],
    ['exported spans', () => JSON.parse(sinks.spans.text()) as unknown],
    ['model prompts', () => sinks.modelPrompts],
  ])('leaves no planted value and no run of 8+ digits in %s', (_, sink) => {
    const value = sink();
    const texts = textsOf(value);
    for (const planted of Object.values(PLANTED)) {
      const pattern = plantedPattern(planted);
      expect(texts.filter((text) => pattern.test(text))).toEqual([]);
    }
    expect(unmaskedRuns(value)).toEqual([]);
  });
});
