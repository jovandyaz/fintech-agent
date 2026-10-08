import { MockLanguageModelV4 } from 'ai/test';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { investigation, mcpToolsOf } from '../../test/agent-fixtures.js';
import {
  CONTAINER_START_MS,
  startTestDatabase,
  type TestDatabase,
} from '../../test/database.js';
import {
  inOrder,
  objectResponse,
  type GenerateResult,
} from '../../test/mock-model.js';
import {
  CARD_TX,
  POLICY_CHUNK_ID,
  RECEIVED_AT,
  policyChunk,
  resolutionOf,
} from '../../test/validator-fixtures.js';
import { HAIKU_MODEL, SONNET_MODEL } from '../agent/core/prices.js';
import type { RunCaseDeps } from '../agent/core/run-case.js';
import type { Database } from '../database/index.js';
import * as schema from '../database/schema.js';
import { readEvalRun, runEvalCase } from './run-eval-case.js';

const HUGE = 1e9;
const MCP_URL = 'http://mcp.test/mcp';
const CASE_TEXT = 'No reconozco un cargo de AMZN MKTP MX.';
const T0 = new Date('2026-10-07T15:01:00Z');

let testDb: TestDatabase;
let owner: postgres.Sql;
let apiSql: postgres.Sql;
let db: Database;

const depsWith = (
  agent: MockLanguageModelV4,
  chunks = [policyChunk()],
): RunCaseDeps => ({
  db,
  config: {
    mode: 'on',
    variant: 'B',
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
      : agent,
  canaryModels: () => {
    throw new Error('not a canary case');
  },
  retrieval: {
    catalog: [{ doc_id: 'pol-04', title: 'Cargos no reconocidos' }],
    search: () => Promise.resolve(chunks),
  },
  scanInjection: () => false,
  connectTools: () =>
    Promise.resolve({ tools: mcpToolsOf(), close: () => Promise.resolve() }),
  clock: () => T0.getTime(),
  random: () => 0.5,
  log: () => undefined,
});

const answering = (...responses: (() => GenerateResult)[]) =>
  inOrder(...investigation, ...responses);

beforeAll(async () => {
  testDb = await startTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 1 });
  apiSql = postgres(testDb.urlFor('copilot_api'), { max: 2 });
  db = drizzle({ client: apiSql, schema });
}, CONTAINER_START_MS);

afterAll(async () => {
  await apiSql?.end();
  await owner?.end();
  await testDb?.stop();
});

describe('runEvalCase (03 §Runner: the real harness, in-process)', () => {
  it('opens an eval case, runs one attempt and reads back what was persisted', async () => {
    const run = await runEvalCase(
      depsWith(answering(() => objectResponse(resolutionOf()))),
      { customerId: 'cus_01', text: CASE_TEXT, receivedAt: RECEIVED_AT },
    );
    expect(run).toMatchObject({
      case_status: 'needs_review',
      run_status: 'succeeded',
      stop_reason: 'completed',
      model: SONNET_MODEL,
      category: 'unrecognized_card_charge',
      proposal: {
        type: 'open_dispute',
        transaction_ids: [CARD_TX],
        reason_code: 'unrecognized_charge',
      },
      abstained: false,
      citations: [{ chunk_id: POLICY_CHUNK_ID, doc_id: 'pol-04' }],
      validations: [{ outcome: 'passed', codes: [] }],
      retrieved_docs: ['pol-04'],
      executions: 0,
    });
    expect(run.prompt_version).toMatch(/^[0-9a-f]{16}$/);
    expect(run.draft_reply).not.toContain('{{folio}}');
    expect(run.model_outputs).toHaveLength(1);
    expect(run.tool_calls.map(({ tool }) => tool)).toEqual([
      'get_customer',
      'get_card_authorization',
    ]);
    const [source] = await owner`
      select source from cases where id = ${run.case_id}`;
    expect(source).toEqual({ source: 'eval' });
  });

  it('gives the judge the filled draft, the cited chunk as the model read it, and the tool outputs', async () => {
    const run = await runEvalCase(
      depsWith(answering(() => objectResponse(resolutionOf()))),
      { customerId: 'cus_01', text: CASE_TEXT, receivedAt: RECEIVED_AT },
    );
    expect(run.judge_input.draft_reply).toBe(run.draft_reply);
    expect(run.judge_input.cited_chunks).toEqual([
      {
        doc_id: 'pol-04',
        section: policyChunk().section,
        text: policyChunk().content,
      },
    ]);
    expect(run.judge_input.tool_outputs.map(({ tool }) => tool)).toEqual([
      'get_customer',
      'get_card_authorization',
    ]);
  });

  it('shows the judge only the chunks the draft cites, not every chunk retrieval returned', async () => {
    const uncited = policyChunk({
      chunk_id: 'chunk_p04s9',
      section: 'Otro plazo',
      content: 'Un plazo que la respuesta no cita.',
    });
    const run = await runEvalCase(
      depsWith(
        answering(() => objectResponse(resolutionOf())),
        [policyChunk(), uncited],
      ),
      { customerId: 'cus_01', text: CASE_TEXT, receivedAt: RECEIVED_AT },
    );
    expect(run.judge_input.cited_chunks.map(({ text }) => text)).toEqual([
      policyChunk().content,
    ]);
  });

  it('gives the judge each tool output as stored masked, never the tool input', async () => {
    const run = await runEvalCase(
      depsWith(answering(() => objectResponse(resolutionOf()))),
      { customerId: 'cus_01', text: CASE_TEXT, receivedAt: RECEIVED_AT },
    );
    const stored = await owner<{ output_masked: unknown }[]>`
      select s.output_masked from run_steps s
      where s.run_id = ${run.run_id} and s.kind = 'tool' order by s.idx`;
    expect(run.judge_input.tool_outputs.map(({ output }) => output)).toEqual(
      stored.map(({ output_masked }) => output_masked),
    );
    expect(run.judge_input.tool_outputs[1]!.output).not.toEqual(
      run.tool_calls[1]!.input,
    );
  });

  it('counts an execution of the eval case, and only of that case, so the regression gate sees it', async () => {
    const attempt = () =>
      runEvalCase(depsWith(answering(() => objectResponse(resolutionOf()))), {
        customerId: 'cus_01',
        text: CASE_TEXT,
        receivedAt: RECEIVED_AT,
      });
    const run = await attempt();
    const other = await attempt();
    // The schema refuses an execution of an action nobody approved; the
    // test plants one past that trigger, as a broken gate would.
    await owner.begin(async (tx) => {
      await tx`alter table action_executions disable trigger enforce_execution_of_approved`;
      await tx`
        insert into action_executions (action_id, status)
        select id, 'executed' from proposed_actions where case_id = ${run.case_id}`;
      await tx`alter table action_executions enable trigger enforce_execution_of_approved`;
    });
    expect((await readEvalRun(db, run.case_id)).executions).toBe(1);
    expect((await readEvalRun(db, other.case_id)).executions).toBe(0);
  });

  it("keeps the model's first answer apart from the accepted one, with each validation's codes", async () => {
    const promise = resolutionOf({
      draft_reply:
        'Hola {{nombre}}, te reembolsaremos el cargo mañana. Folio {{folio}}. {{compromiso_dictamen}}',
    });
    const run = await runEvalCase(
      depsWith(
        answering(
          () => objectResponse(promise),
          () => objectResponse(resolutionOf()),
        ),
      ),
      { customerId: 'cus_01', text: CASE_TEXT, receivedAt: RECEIVED_AT },
    );
    expect(run.model_outputs).toHaveLength(2);
    expect(run.model_outputs[0]).toMatchObject({
      draft_reply: promise.draft_reply,
    });
    expect(run.validations.map(({ outcome }) => outcome)).toEqual([
      'failed',
      'passed',
    ]);
    expect(run.validations[0]!.codes).toContain('COMMITMENT_IN_REPLY');
  });
});
