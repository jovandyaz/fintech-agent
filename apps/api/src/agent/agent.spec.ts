import {
  maskJson,
  type McpToolName,
  type Resolution,
} from '@fintech-agent/contracts';
import { type ToolSet } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  investigation,
  mcpFailed,
  mcpOk,
  mcpToolsOf,
  type McpAnswer,
} from '../../test/agent-fixtures.js';
import {
  inOrder,
  malformedJson,
  tooManyRequests,
  type GenerateResult,
  objectResponse,
  toolCallResponse,
  usage,
} from '../../test/mock-model.js';
import { captureSpans } from '../../test/spans.js';
import {
  CARD_TX,
  NOW,
  RECEIVED_AT,
  cardAuth,
  policyChunk,
  resolutionOf,
  speiStatus,
} from '../../test/validator-fixtures.js';
import {
  MIN_MODEL_CALL_MS,
  RUN_MAX_STEPS,
  runAgent,
  traceTotals,
  type AgentInput,
  type AgentOutcome,
  type StepRecord,
} from './core/agent.js';
import { computeTokenCostUsd } from './core/cost.js';
import {
  PRICED_PROMPT_TOKENS_MAX,
  SONNET_MODEL,
  pricingOf,
} from './core/prices.js';
import { SYSTEM_PROMPT, caseMessage } from './core/prompt.js';
import { isProviderOutage, providerErrorOf } from './core/provider-errors.js';
import { RETRIEVAL_UNAVAILABLE, searchPoliciesTool } from './core/tools.js';
import type { ChunkStateRules } from './core/validate/state-rules.js';

const CASE_TEXT = 'No reconozco un cargo de AMZN MKTP MX en mi tarjeta.';
const RUN_TIMEOUT_MS = 180_000;
const HUGE = 1e9;

function toolsOf(
  answers: Partial<Record<McpToolName, McpAnswer>> = {},
): ToolSet {
  return {
    ...mcpToolsOf(answers),
    search_policies: searchPoliciesTool({
      catalog: [{ doc_id: 'pol-04', title: 'Cargos no reconocidos' }],
      search: () => Promise.resolve([policyChunk()]),
    }),
  };
}

const logs: Record<string, unknown>[] = [];

function inputOf(
  model: MockLanguageModelV4,
  overrides: Partial<AgentInput> = {},
): AgentInput {
  return {
    model,
    modelId: SONNET_MODEL,
    tools: toolsOf(),
    caseText: CASE_TEXT,
    stateRules: [],
    receivedAt: RECEIVED_AT,
    injectionSignal: false,
    crossCustomerLookup: () => Promise.resolve(false),
    budget: { costUsd: HUGE, inputTokens: HUGE },
    deadlineMs: NOW.getTime() + RUN_TIMEOUT_MS,
    clock: () => NOW.getTime(),
    log: (event) => logs.push(event),
    trace: [],
    ...overrides,
  };
}

const run = async (input: AgentInput) =>
  Object.assign(await runAgent(input), { trace: input.trace });

const evidenceOf = (outcome: AgentOutcome) =>
  outcome.kind === 'validated' ? outcome.validation.evidence : outcome.evidence;

const withAction = (
  action: Partial<Resolution['proposed_action']> | Record<string, unknown>,
) => {
  const resolution = resolutionOf();
  return {
    ...resolution,
    proposed_action: { ...resolution.proposed_action, ...action },
  };
};

const lastUserText = (model: MockLanguageModelV4): string => {
  const prompt = model.doGenerateCalls.at(-1)!.prompt;
  const last = prompt.at(-1)!;
  expect(last.role).toBe('user');
  return JSON.stringify(last.content);
};

describe('runAgent (01 §The agentic node)', () => {
  it('validates the resolution of a run that investigated through the tools', async () => {
    const model = inOrder(...investigation, () =>
      objectResponse(resolutionOf()),
    );
    const outcome = await run(inputOf(model));
    expect(outcome).toMatchObject({
      kind: 'validated',
      validation: {
        kind: 'valid',
        resolution: resolutionOf(),
        repaired: false,
      },
    });
  });

  it('sends the static system prompt, and the case text as data in the user role (02 G7)', async () => {
    const model = inOrder(...investigation, () =>
      objectResponse(resolutionOf()),
    );
    await run(inputOf(model));
    const [system, user] = model.doGenerateCalls[0]!.prompt;
    expect(system).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(user).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: caseMessage(CASE_TEXT) }],
    });
  });

  it('records every model step with its tokens and cost, and every tool call masked', async () => {
    const model = inOrder(...investigation, () =>
      objectResponse(resolutionOf()),
    );
    const outcome = await run(inputOf(model));
    const stepCost = computeTokenCostUsd(
      { inputTokens: 11, outputTokens: 7 },
      pricingOf(SONNET_MODEL),
    );
    const llm = outcome.trace.filter(({ kind }) => kind === 'llm');
    expect(llm).toHaveLength(investigation.length + 1);
    expect(llm[0]).toMatchObject({
      name: SONNET_MODEL,
      inputTokens: 11,
      outputTokens: 7,
      cachedInputTokens: 0,
      costUsd: stepCost,
      finishReason: 'tool-calls',
    });
    expect(traceTotals(outcome.trace).costUsd).toBeCloseTo(
      stepCost * llm.length,
      12,
    );
    expect(
      outcome.trace
        .filter(({ kind }) => kind === 'tool' || kind === 'retrieval')
        .map(({ kind, name }) => [kind, name]),
    ).toEqual([
      ['tool', 'get_customer'],
      ['tool', 'get_card_authorization'],
      ['retrieval', 'search_policies'],
    ]);
    expect(
      outcome.trace.find(({ name }) => name === 'get_card_authorization'),
    ).toMatchObject({
      inputMasked: maskJson({ transaction_id: CARD_TX }),
      outputMasked: maskJson(mcpOk(cardAuth())),
    });
    expect(outcome.trace.at(-1)).toMatchObject({
      kind: 'validation',
      outputMasked: { outcome: 'passed', codes: [] },
    });
  });

  it('hands the model a fixed error, never the raw message, when policy search fails', async () => {
    const capture = captureSpans({ masked: false });
    // The cited chunk was never seen, so the validator asks for one repair.
    const model = inOrder(
      ...investigation,
      () => objectResponse(resolutionOf()),
      () => objectResponse(resolutionOf()),
    );
    await run(
      inputOf(model, {
        telemetry: capture.telemetry,
        tools: {
          ...mcpToolsOf(),
          search_policies: searchPoliciesTool({
            catalog: [{ doc_id: 'pol-04', title: 'Cargos no reconocidos' }],
            search: () =>
              Promise.reject(new Error('connection to 5512345678 refused')),
          }),
        },
      }),
    );
    const afterSearch = JSON.stringify(
      model.doGenerateCalls[investigation.length]?.prompt,
    );
    expect(afterSearch).toContain(RETRIEVAL_UNAVAILABLE);
    expect(afterSearch).not.toContain('5512345678');
    expect(capture.text()).not.toContain('5512345678');
  });

  it('traces its calls with no case text, tool data or reply in any span (02 G6, Traces)', async () => {
    const capture = captureSpans({ masked: false });
    const model = inOrder(...investigation, () =>
      objectResponse(resolutionOf()),
    );
    await run(inputOf(model, { telemetry: capture.telemetry }));
    expect(capture.spans().length).toBeGreaterThan(investigation.length);
    const text = capture.text();
    expect(text).not.toContain('AMZN');
    expect(text).not.toContain(CARD_TX);
    expect(text).not.toContain('cargo no reconocido');
    expect(text).not.toContain(resolutionOf().draft_reply);
  });

  it('repairs a refund action, which the schema refuses, with the SCHEMA code as a new user turn', async () => {
    const model = inOrder(
      ...investigation,
      () => objectResponse(withAction({ type: 'refund' })),
      () => objectResponse(resolutionOf()),
    );
    const outcome = await run(inputOf(model));
    expect(outcome).toMatchObject({
      kind: 'validated',
      validation: { kind: 'valid', repaired: true },
    });
    expect(lastUserText(model)).toContain('SCHEMA');
  });

  it('repairs a citation of a chunk the run never saw', async () => {
    const [citation] = resolutionOf().citations;
    const model = inOrder(
      ...investigation,
      () =>
        objectResponse(
          resolutionOf({
            citations: [{ ...citation!, chunk_id: 'chunk_p09s1' }],
          }),
        ),
      () => objectResponse(resolutionOf()),
    );
    const outcome = await run(inputOf(model));
    expect(outcome).toMatchObject({ validation: { repaired: true } });
    expect(lastUserText(model)).toContain('CITATION_UNSEEN');
  });

  it('grounds the repaired output on what the first turn saw', async () => {
    const model = inOrder(...investigation, malformedJson, () =>
      objectResponse(resolutionOf()),
    );
    const outcome = await run(inputOf(model));
    expect(outcome).toMatchObject({
      validation: { kind: 'valid', repaired: true },
    });
  });

  it('appends the repair turn after the run so far, never editing it', async () => {
    const model = inOrder(...investigation, malformedJson, () =>
      objectResponse(resolutionOf()),
    );
    await run(inputOf(model));
    const failed = model.doGenerateCalls.at(-2)!.prompt;
    const repair = model.doGenerateCalls.at(-1)!.prompt;
    expect(repair.slice(0, failed.length)).toEqual(failed);
    expect(repair.slice(failed.length).map(({ role }) => role)).toEqual([
      'assistant',
      'user',
    ]);
  });

  it('falls back to none after malformed JSON twice', async () => {
    const model = inOrder(...investigation, malformedJson, malformedJson);
    const outcome = await run(inputOf(model));
    expect(outcome).toMatchObject({
      kind: 'validated',
      validation: {
        kind: 'fallback',
        codes: ['SCHEMA'],
        action: { type: 'none', transaction_ids: [] },
      },
    });
    expect(outcome.trace.at(-1)).toMatchObject({
      kind: 'validation',
      outputMasked: { outcome: 'failed', codes: ['SCHEMA'] },
    });
  });
});

describe('runAgent budget (01 §Context policy)', () => {
  const heavy = usage(40_000, 7);

  it('stops on the input-token ceiling and falls back, never repairing', async () => {
    const model = inOrder(
      () => toolCallResponse('get_customer', {}, heavy),
      () => toolCallResponse('list_transactions', {}, heavy),
    );
    const outcome = await run(
      inputOf(model, { budget: { costUsd: HUGE, inputTokens: 60_000 } }),
    );
    expect(outcome).toMatchObject({ kind: 'stopped', stopReason: 'budget' });
    expect(model.doGenerateCalls).toHaveLength(2);
  });

  it('stops on the cost ceiling', async () => {
    const stepCost = computeTokenCostUsd(
      { inputTokens: 40_000, outputTokens: 7 },
      pricingOf(SONNET_MODEL),
    );
    const model = inOrder(
      () => toolCallResponse('get_customer', {}, heavy),
      () => toolCallResponse('list_transactions', {}, heavy),
    );
    const outcome = await run(
      inputOf(model, {
        budget: { costUsd: stepCost * 1.5, inputTokens: HUGE },
      }),
    );
    expect(outcome).toMatchObject({ kind: 'stopped', stopReason: 'budget' });
  });

  it('stops when a step’s prompt passes the priced tier, whatever the ceilings', async () => {
    const model = inOrder(() =>
      toolCallResponse(
        'get_customer',
        {},
        usage(PRICED_PROMPT_TOKENS_MAX + 1, 7),
      ),
    );
    const outcome = await run(inputOf(model));
    expect(outcome).toMatchObject({ kind: 'stopped', stopReason: 'budget' });
  });

  it('does not repair when the budget ran out on the output itself', async () => {
    const model = inOrder(() => objectResponse({ broken: true }, heavy));
    const outcome = await run(
      inputOf(model, { budget: { costUsd: HUGE, inputTokens: 30_000 } }),
    );
    expect(outcome).toMatchObject({ kind: 'stopped', stopReason: 'budget' });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it('offers no tools on the last allowed step, so the model must answer', async () => {
    const calls = Array.from(
      { length: RUN_MAX_STEPS - 1 },
      () => () => toolCallResponse('get_customer', {}),
    );
    const model = inOrder(...calls, () => objectResponse(resolutionOf()));
    await run(inputOf(model));
    expect(model.doGenerateCalls).toHaveLength(RUN_MAX_STEPS);
    expect(model.doGenerateCalls.at(-2)!.tools?.length).toBeGreaterThan(0);
    expect(model.doGenerateCalls.at(-1)!.tools ?? []).toEqual([]);
  });

  it('skips a model call with too little time left', async () => {
    const model = inOrder();
    const outcome = await run(
      inputOf(model, { deadlineMs: NOW.getTime() + MIN_MODEL_CALL_MS - 1 }),
    );
    expect(outcome).toMatchObject({ kind: 'stopped', stopReason: 'budget' });
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});

describe('runAgent tool failures (01 §Failure handling)', () => {
  const speiLookup = () =>
    toolCallResponse('get_spei_status', { transaction_id: 'tx_s001' });

  it('returns a tool error to the model once, and ends the run on the second', async () => {
    const model = inOrder(speiLookup, speiLookup);
    const outcome = await run(
      inputOf(model, {
        tools: toolsOf({
          get_spei_status: () => mcpFailed('UPSTREAM_UNAVAILABLE'),
        }),
      }),
    );
    expect(outcome).toMatchObject({
      kind: 'stopped',
      stopReason: 'error',
      reason: 'tool_failed:get_spei_status',
    });
    expect(model.doGenerateCalls).toHaveLength(2);
  });

  it('lets the model repair invalid arguments without counting them as failures', async () => {
    const model = inOrder(speiLookup, speiLookup, ...investigation, () =>
      objectResponse(resolutionOf()),
    );
    const outcome = await run(
      inputOf(model, {
        tools: toolsOf({
          get_spei_status: () => mcpFailed('INVALID_ARGUMENTS'),
        }),
      }),
    );
    expect(outcome).toMatchObject({ kind: 'validated' });
  });

  it('counts a tool that throws or times out as a failure', async () => {
    const model = inOrder(speiLookup, speiLookup);
    const outcome = await run(
      inputOf(model, {
        tools: toolsOf({
          get_spei_status: () => {
            throw new Error('socket hang up');
          },
        }),
      }),
    );
    expect(outcome).toMatchObject({ stopReason: 'error' });
    expect(
      outcome.trace.filter(({ kind }) => kind === 'tool').at(-1),
    ).toMatchObject({
      name: 'get_spei_status',
      outputMasked: {
        error: expect.stringContaining('socket hang up') as unknown,
      },
    });
  });

  it('keeps an MCP error answer out of the evidence, even one shaped like a status', async () => {
    const model = inOrder(
      speiLookup,
      () => objectResponse(resolutionOf()),
      () => objectResponse(resolutionOf()),
    );
    const outcome = await run(
      inputOf(model, {
        tools: toolsOf({
          get_spei_status: () => ({
            ...mcpOk(speiStatus({ cep_available: true })),
            isError: true,
          }),
        }),
      }),
    );
    expect(evidenceOf(outcome).speiStatuses.size).toBe(0);
  });
});

describe('runAgent step records (02 G6)', () => {
  const PHONE = '5512345678';
  const LONG_DIGITS = /\d{8,}/;
  const stringsIn = (value: unknown): string[] =>
    typeof value === 'string'
      ? [value]
      : typeof value === 'object' && value !== null
        ? Object.values(value).flatMap(stringsIn)
        : [];
  const textOf = (steps: readonly StepRecord[]): string =>
    JSON.stringify(
      steps.map(({ name, inputMasked, outputMasked }) => [
        name,
        inputMasked,
        outputMasked,
      ]),
    );

  it('masks personal data the model writes, value by value', async () => {
    const model = inOrder(
      ...investigation,
      () =>
        objectResponse(
          resolutionOf({
            reasoning_summary: `La clienta dejó su teléfono ${PHONE}.`,
          }),
        ),
      () => objectResponse(resolutionOf()),
    );
    const outcome = await run(inputOf(model));
    expect(textOf(outcome.trace)).not.toMatch(LONG_DIGITS);
  });

  it('masks the model’s output value by value, never as serialized text', async () => {
    const model = inOrder(
      ...investigation,
      () =>
        objectResponse(
          resolutionOf({ reasoning_summary: 'Llamar al 55\n2019\n2020.' }),
        ),
      () => objectResponse(resolutionOf()),
    );
    const outcome = await run(inputOf(model));
    const lines = stringsIn(
      outcome.trace.map(({ outputMasked }) => outputMasked),
    );
    for (const text of lines) {
      expect(text.replace(/\\n|\n/g, '')).not.toMatch(LONG_DIGITS);
    }
  });

  it('masks a thrown tool error and a tool name the model made up', async () => {
    const model = inOrder(
      () => toolCallResponse('get_spei_status', { transaction_id: 'tx_s001' }),
      () => toolCallResponse(`tel${PHONE}`, {}),
      () => objectResponse(resolutionOf()),
      () => objectResponse(resolutionOf()),
    );
    const outcome = await run(
      inputOf(model, {
        tools: toolsOf({
          get_spei_status: () => {
            throw new Error(`core said: call ${PHONE}`);
          },
        }),
      }),
    );
    const tools = outcome.trace.filter(({ kind }) => kind === 'tool');
    expect(tools).toHaveLength(2);
    expect(textOf(tools)).not.toMatch(LONG_DIGITS);
  });
});

describe('runAgent validator errors', () => {
  const lateReturn: ChunkStateRules[] = [
    {
      chunk_id: 'chunk_p02s3',
      quarantined: false,
      rules: [
        {
          id: 'return_credit_same_day',
          applies_to: {
            type: 'spei_out',
            status: 'returned',
            returned_business_days_ago: '>=1',
          },
          requires: { field: 'reversal_credit_id', not_null: true },
        },
      ],
    },
  ];

  it('ends the run, logged, when the validator cannot read the calendar', async () => {
    logs.length = 0;
    const model = inOrder(
      ...investigation,
      () => toolCallResponse('get_spei_status', { transaction_id: 'tx_s001' }),
      () => objectResponse(resolutionOf()),
    );
    const outcome = await run(
      inputOf(model, {
        tools: toolsOf({
          get_spei_status: () =>
            mcpOk(
              speiStatus({
                status: 'returned',
                returned_at: '2025-12-30T17:00:00Z',
              }),
            ),
        }),
        receivedAt: new Date('2026-01-02T17:00:00Z'),
        stateRules: lateReturn,
      }),
    );
    expect(outcome).toMatchObject({
      kind: 'stopped',
      stopReason: 'error',
      reason: 'validator_error',
    });
    expect(logs).toEqual([
      {
        event: 'validator_error',
        error: expect.stringContaining('CalendarRangeError') as unknown,
      },
    ]);
  });
});

describe('runAgent repair budget', () => {
  it('falls back on budget when the repair turn has no time left', async () => {
    let now = NOW.getTime();
    const model = inOrder(...investigation, () => {
      now += RUN_TIMEOUT_MS;
      return malformedJson();
    });
    const outcome = await run(inputOf(model, { clock: () => now }));
    expect(outcome).toMatchObject({ kind: 'stopped', stopReason: 'budget' });
    expect(model.doGenerateCalls).toHaveLength(investigation.length + 1);
  });
});

describe('runAgent review round', () => {
  const unparsableCall = (toolName: string): GenerateResult => ({
    content: [
      {
        type: 'tool-call',
        toolCallId: `bad-${toolName}`,
        toolName,
        input: '{bad',
      },
    ],
    finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
    usage: usage(),
    warnings: [],
  });

  it('keeps the steps already taken in the trace when a provider error ends the run', async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: () => {
        calls += 1;
        return calls === 1
          ? Promise.resolve(toolCallResponse('get_customer', {}))
          : Promise.reject(tooManyRequests());
      },
    });
    const input = inputOf(model);
    await expect(runAgent(input)).rejects.toThrow();
    expect(input.trace.map(({ kind, name }) => [kind, name])).toEqual([
      ['llm', SONNET_MODEL],
      ['tool', 'get_customer'],
    ]);
  });

  it('stops before a model call once too little time is left in the turn', async () => {
    let now = NOW.getTime();
    const deadlineMs = now + RUN_TIMEOUT_MS;
    const model = inOrder(() => {
      now = deadlineMs - MIN_MODEL_CALL_MS + 1;
      return toolCallResponse('get_customer', {});
    });
    const outcome = await run(inputOf(model, { clock: () => now, deadlineMs }));
    expect(outcome).toMatchObject({ kind: 'stopped', stopReason: 'budget' });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(outcome.trace.some(({ kind }) => kind === 'validation')).toBe(false);
  });

  it('counts the repair turn against the 8-step cap', async () => {
    const calls = Array.from(
      { length: RUN_MAX_STEPS - 1 },
      () => () => toolCallResponse('get_customer', {}),
    );
    const model = inOrder(...calls, malformedJson);
    const outcome = await run(inputOf(model));
    expect(outcome).toMatchObject({ kind: 'stopped', stopReason: 'budget' });
    expect(model.doGenerateCalls).toHaveLength(RUN_MAX_STEPS);
  });

  it('offers no tools to a repair turn that has one step left', async () => {
    const calls = Array.from(
      { length: RUN_MAX_STEPS - 2 },
      () => () => toolCallResponse('get_customer', {}),
    );
    const model = inOrder(
      ...investigation.slice(1),
      ...calls.slice(2),
      malformedJson,
      () => objectResponse(resolutionOf()),
    );
    const outcome = await run(inputOf(model));
    expect(model.doGenerateCalls).toHaveLength(RUN_MAX_STEPS);
    expect(model.doGenerateCalls.at(-1)!.tools ?? []).toEqual([]);
    expect(outcome).toMatchObject({ kind: 'validated' });
  });

  it('ends the run when the repair would drop what the first turn saw', async () => {
    logs.length = 0;
    let lookups = 0;
    const model = inOrder(...investigation, malformedJson, () =>
      objectResponse(resolutionOf()),
    );
    const outcome = await run(
      inputOf(model, {
        crossCustomerLookup: () => Promise.resolve(++lookups === 1),
      }),
    );
    expect(outcome).toMatchObject({
      kind: 'stopped',
      stopReason: 'error',
      reason: 'validator_error',
    });
    expect(logs).toEqual([
      {
        event: 'validator_error',
        error: expect.stringContaining('RepairEvidenceError') as unknown,
      },
    ]);
  });

  it('does not count calls the SDK could not parse as tool failures', async () => {
    const model = inOrder(
      () => unparsableCall('get_spei_status'),
      () => unparsableCall('get_spei_status'),
      ...investigation,
      () => objectResponse(resolutionOf()),
    );
    const outcome = await run(inputOf(model));
    expect(outcome).toMatchObject({ kind: 'validated' });
    expect(
      outcome.trace.find(({ name }) => name === 'get_spei_status'),
    ).toMatchObject({
      kind: 'tool',
      latencyMs: null,
    });
  });

  it('records the provider request id from the response headers', async () => {
    const model = inOrder(...investigation, () => ({
      ...objectResponse(resolutionOf()),
      response: { headers: { 'request-id': 'req_011' } },
    }));
    const outcome = await run(inputOf(model));
    expect(
      outcome.trace.filter(({ kind }) => kind === 'llm').at(-1),
    ).toMatchObject({ providerRequestId: 'req_011' });
  });
});

describe('runAgent verifier gaps', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('masks personal data in the arguments the model sends a tool', async () => {
    const model = inOrder(
      () => toolCallResponse('list_transactions', { query: 'tel 5512345678' }),
      ...investigation,
      () => objectResponse(resolutionOf()),
    );
    const outcome = await run(inputOf(model));
    const listing = outcome.trace.find(
      ({ name }) => name === 'list_transactions',
    );
    expect(JSON.stringify(listing?.inputMasked)).not.toMatch(/\d{8,}/);
  });

  it('bounds the turn by the time left and each tool call by 10 s', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const model = inOrder(...investigation, () =>
      objectResponse(resolutionOf()),
    );
    await run(inputOf(model));
    const asked = timeout.mock.calls.map(([ms]) => ms);
    expect(asked).toContain(RUN_TIMEOUT_MS);
    expect(asked).toContain(10_000);
  });

  it('ends a model call that answers nothing after 60 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const model = new MockLanguageModelV4({
      doGenerate: ({ abortSignal }) =>
        new Promise((_, reject) => {
          abortSignal?.addEventListener('abort', () => {
            reject(abortSignal.reason as Error);
          });
        }),
    });
    let settled: string | undefined;
    let failure: unknown;
    void run(inputOf(model)).then(
      () => (settled = 'resolved'),
      (error: unknown) => {
        failure = error;
        settled = (error as Error).message;
      },
    );
    // setImmediate is not faked, so it drains the rejection chain without
    // moving the clock; a wrong timeout then fails here instead of hanging.
    const drain = () => new Promise((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(59_999);
    await drain();
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await drain();
    expect(settled).toContain('Step timeout of 60000ms');
    // The worker reads this error as it leaves runAgent: a retryable
    // provider failure that is not an outage (01 §Failure handling).
    expect(providerErrorOf(failure)).toBe('provider_unavailable');
    expect(isProviderOutage(failure)).toBe(false);
  });

  it('records cached input tokens and the latency of model and tool steps', async () => {
    const model = inOrder(
      () => toolCallResponse('get_customer', {}, usage(11, 7, 5)),
      ...investigation.slice(1),
      () => objectResponse(resolutionOf()),
    );
    const outcome = await run(inputOf(model));
    const [llm, tool] = outcome.trace;
    expect(llm).toMatchObject({ kind: 'llm', cachedInputTokens: 5 });
    expect(llm?.latencyMs).toEqual(expect.any(Number));
    expect(tool).toMatchObject({ kind: 'tool', name: 'get_customer' });
    expect(tool?.latencyMs).toEqual(expect.any(Number));
  });

  it('stops the repair turn at the step where a tool fails for the second time', async () => {
    const speiLookup = () =>
      toolCallResponse('get_spei_status', { transaction_id: 'tx_s001' });
    const model = inOrder(speiLookup, malformedJson, speiLookup);
    const outcome = await run(
      inputOf(model, {
        tools: toolsOf({
          get_spei_status: () => mcpFailed('UPSTREAM_UNAVAILABLE'),
        }),
      }),
    );
    expect(outcome).toMatchObject({
      kind: 'stopped',
      reason: 'tool_failed:get_spei_status',
    });
    expect(model.doGenerateCalls).toHaveLength(3);
  });
});
