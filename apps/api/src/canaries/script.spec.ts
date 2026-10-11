import {
  ListTransactionsInputSchema,
  ResolutionSchema,
  maskPii,
} from '@fintech-agent/contracts';
import type { LanguageModel } from 'ai';
import { describe, expect, it } from 'vitest';

import { seededRandom, seededRandomAfter } from '../../test/seeded-random.js';
import { HAIKU_MODEL, SONNET_MODEL, pricingOf } from '../agent/core/prices.js';
import { asCustomerData, caseMessage } from '../agent/core/prompt.js';
import { POLICY_SEARCH_TOOL } from '../agent/core/validate/evidence.js';
import { AGENT_VARIANTS, type AgentVariant } from '../config.js';
import {
  REAL_RUNS,
  UNGROUNDED_REPAIR_TOKENS,
  type Spread,
  type TokenLine,
} from './real-runs.js';
import {
  assertCanaryCalibration,
  canaryModelsOf,
  investigationOf,
  misreadResolutionOf,
  resolutionOf,
  type ScriptPacing,
} from './script.js';
import { CANARY_TEMPLATES, type CanaryTemplate } from './templates.js';

type ModelV4 = Extract<LanguageModel, { specificationVersion: 'v4' }>;
type CallOptions = Parameters<ModelV4['doGenerate']>[0];
type Generated = Awaited<ReturnType<ModelV4['doGenerate']>>;
type Message = CallOptions['prompt'][number];

const CALL: CallOptions = { prompt: [] };
const [TEMPLATE] = CANARY_TEMPLATES;
const SHORTEST_REDACTOR_MS = 600;
// setTimeout may fire a fraction of a millisecond early against performance.now().
const TIMER_SLACK_MS = 1;
const RUNS_PER_TEMPLATE = 200;
// Wider than the sampling noise of 200 runs, narrower than the gap between
// the variants' shares, so a canary on the other variant's share fails.
const REPAIR_SHARE_TOLERANCE = 0.1;
// One repair turn, then the harness falls back: a canary must never get there.
const MAX_VALIDATIONS = 2;
const GUARD_STEPS = ['redaction', 'injection_scan'].length;
// The harness's RUN_MAX_STEPS: a script that never answers must fail here, not hang.
const MODEL_CALL_CAP = 8;
const LEAD_IN_MAX_CHARS = 160;
const NO_REPAIR_DRAW = 0.99;
// About what the dataset's tools return, in characters the model reads.
const READ_CHARS: Readonly<Record<string, number>> = {
  get_customer: 300,
  list_transactions: 900,
  get_card_authorization: 450,
  get_spei_status: 450,
  [POLICY_SEARCH_TOOL]: 1_200,
};
// A drawn residual is rounded into whole tokens.
const ROUNDING = 0.5;
const CONVERSATIONS = 20;
const OPENINGS = 400;
// A quarter of real calls sit below the residual's q1 and a quarter above its
// q3; a canary that never lands there would stand out across a batch.
const TAIL_SHARE = 0.25;
const TAIL_TOLERANCE = 0.08;
const REPAIR_DRAW = 0;
const REQUEST_ID = /^req_011C[0-9A-Za-z]{20}$/;
const TOOL_CALL_ID = /^toolu_01[0-9A-Za-z]{22}$/;
// A bare limit or cursor only pages the list, so it does not count as a filter.
const NARROWING_FILTERS = [
  'type',
  'status',
  'from',
  'to',
  'min_amount',
  'max_amount',
  'query',
] as const;

function pacing(random: () => number): ScriptPacing & { slept: number[] } {
  const slept: number[] = [];
  return {
    slept,
    random,
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
  };
}

const SYSTEM: Message = { role: 'system', content: 'Instructions.' };
const userSays = (text: string): Message => ({
  role: 'user',
  content: [{ type: 'text', text }],
});
const REPAIR = userSays(
  'Your resolution failed validation with: UNGROUNDED_NUMBER. Correct it and answer again with the complete resolution.',
);
const caseTextOf = ({ seed }: CanaryTemplate): string =>
  maskPii(seed.texts.at(-1)!);
// How the harness opens a model's conversation: its instructions and the case.
const opening = (text: string): Message[] => [SYSTEM, userSays(text)];

const drawingFirst = (first: number, seed = 1) =>
  seededRandomAfter(first, seed);

const modelsFor = (
  template: CanaryTemplate = TEMPLATE!,
  paced = pacing(seededRandom(1)),
  variant: AgentVariant = 'A',
) =>
  canaryModelsOf(template, {
    variant,
    modelId: REAL_RUNS[variant].model,
    redactorModelId: HAIKU_MODEL,
    pacing: paced,
  });

const toolCallsOf = (content: Generated['content']) =>
  content.flatMap((part) =>
    part.type === 'tool-call'
      ? [
          {
            id: part.toolCallId,
            tool: part.toolName,
            input: JSON.parse(part.input) as Record<string, unknown>,
          },
        ]
      : [],
  );

const textOf = (content: Generated['content']) =>
  content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('');

const answered = ({ content }: Generated): Message => ({
  role: 'assistant',
  content: [{ type: 'text', text: textOf(content) }],
});

const resultsOf = (
  { content }: Generated,
  charsOf: (tool: string) => number = (tool) => READ_CHARS[tool]!,
): Message => ({
  role: 'tool',
  content: toolCallsOf(content).map(({ id, tool }) => ({
    type: 'tool-result',
    toolCallId: id,
    toolName: tool,
    output: { type: 'text', value: 'x'.repeat(charsOf(tool)) },
  })),
});

const inputOf = ({ usage }: Generated): number => usage.inputTokens.total!;
const outputOf = ({ usage }: Generated): number => usage.outputTokens.total!;

function expectOnLine(line: TokenLine, chars: number, tokens: number): void {
  const residual = tokens - (line.base + line.perChar * chars);
  expect(residual).toBeGreaterThanOrEqual(line.residual.min - ROUNDING);
  expect(residual).toBeLessThanOrEqual(line.residual.max + ROUNDING);
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

interface RunTotals {
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  costUsd: number;
  steps: number;
  toolCalls: number;
  validations: number;
  requestIds: string[];
  toolCallIds: string[];
}

// Counted as run_steps would hold the run; any answer but the template's is
// one the validator sends back for repair.
async function scriptedRun(
  template: CanaryTemplate,
  random: () => number,
  variant: AgentVariant = 'A',
): Promise<RunTotals> {
  const paced = pacing(random);
  const { redactor, agent } = modelsFor(template, paced, variant);
  const clean = JSON.stringify(resolutionOf(template.seed));
  const text = caseTextOf(template);
  const redacted = await redactor.doGenerate({
    prompt: opening(asCustomerData(text)),
  });
  const agentCalls: Generated[] = [];
  let prompt = opening(caseMessage(text));
  let validations = 0;
  let toolResults = 0;
  let toolCalls = 0;
  while (agentCalls.length < MODEL_CALL_CAP) {
    const call = await agent.doGenerate({ prompt });
    agentCalls.push(call);
    const calls = toolCallsOf(call.content);
    if (calls.length > 0) {
      toolResults += calls.length;
      toolCalls += calls.filter(
        ({ tool }) => tool !== POLICY_SEARCH_TOOL,
      ).length;
      prompt = [...prompt, answered(call), resultsOf(call)];
      continue;
    }
    validations += 1;
    if (textOf(call.content) === clean) break;
    prompt = [...prompt, answered(call), REPAIR];
  }
  const sum = (
    calls: readonly Generated[],
    key: 'inputTokens' | 'outputTokens',
  ) => calls.reduce((total, { usage }) => total + (usage[key].total ?? 0), 0);
  const priced = (calls: readonly Generated[], model: string) =>
    sum(calls, 'inputTokens') * pricingOf(model).inputCostPerToken! +
    sum(calls, 'outputTokens') * pricingOf(model).outputCostPerToken!;
  return {
    inputTokens: sum([redacted, ...agentCalls], 'inputTokens'),
    outputTokens: sum([redacted, ...agentCalls], 'outputTokens'),
    latencyMs: paced.slept.reduce((total, ms) => total + ms, 0),
    costUsd:
      priced([redacted], HAIKU_MODEL) +
      priced(agentCalls, REAL_RUNS[variant].model),
    steps: GUARD_STEPS + agentCalls.length + toolResults + validations,
    toolCalls,
    validations,
    requestIds: [redacted, ...agentCalls].map(
      ({ response }) => response?.headers?.['request-id'] ?? '',
    ),
    toolCallIds: agentCalls.flatMap(({ content }) =>
      toolCallsOf(content).map(({ id }) => id),
    ),
  };
}

// Seeds of their own per template, so each template's share is an independent sample.
const runsOf = (
  template: CanaryTemplate,
  variant: AgentVariant,
): Promise<RunTotals[]> => {
  const firstSeed = CANARY_TEMPLATES.indexOf(template) * RUNS_PER_TEMPLATE + 1;
  return Promise.all(
    Array.from({ length: RUNS_PER_TEMPLATE }, (_, run) =>
      scriptedRun(template, seededRandom(firstSeed + run), variant),
    ),
  );
};

function expectWithin(values: readonly number[], spread: Spread): void {
  expect(Math.min(...values)).toBeGreaterThanOrEqual(spread.min);
  expect(Math.max(...values)).toBeLessThanOrEqual(spread.max);
  expect(median(values)).toBeGreaterThanOrEqual(spread.q1);
  expect(median(values)).toBeLessThanOrEqual(spread.q3);
}

describe('canaryModelsOf (02 G3)', () => {
  it.each(CANARY_TEMPLATES)(
    '$defect opens with the customer and its filtered movements in one step, after a short lead-in',
    async (template) => {
      const { agent } = modelsFor(template);
      const first = await agent.doGenerate(CALL);
      expect(first.finishReason.unified).toBe('tool-calls');
      const leadIn = textOf(first.content);
      expect(leadIn.length).toBeGreaterThan(0);
      expect(leadIn.length).toBeLessThanOrEqual(LEAD_IN_MAX_CHARS);
      const calls = toolCallsOf(first.content);
      expect(calls.map(({ tool, input }) => ({ tool, input }))).toEqual([
        { tool: 'get_customer', input: {} },
        { tool: 'list_transactions', input: template.seed.listFilter },
      ]);
      const filter = ListTransactionsInputSchema.parse(calls[1]!.input);
      expect(NARROWING_FILTERS.some((key) => filter[key] !== undefined)).toBe(
        true,
      );
    },
  );

  it.each(CANARY_TEMPLATES)(
    '$defect then looks up its transactions and searches its policies together, in phrases of its own',
    async (template) => {
      const { seed } = template;
      const { agent } = modelsFor(template);
      await agent.doGenerate(CALL);
      const second = await agent.doGenerate(CALL);
      expect(second.finishReason.unified).toBe('tool-calls');
      expect(textOf(second.content).length).toBeGreaterThan(0);
      const calls = toolCallsOf(second.content);
      expect(
        calls
          .filter(({ tool }) => tool !== POLICY_SEARCH_TOOL)
          .map(({ tool, input }) => ({ tool, input })),
      ).toEqual(
        seed.lookups.map(({ tool, transaction_id }) => ({
          tool,
          input: { transaction_id },
        })),
      );
      const searches = calls.filter(({ tool }) => tool === POLICY_SEARCH_TOOL);
      expect(searches).toHaveLength(seed.policies.length);
      for (const [index, { citation, queries }] of seed.policies.entries()) {
        const { input } = searches[index]!;
        expect(input['doc_id']).toBe(citation.doc_id);
        expect(queries).toContain(input['query']);
        expect(input['query']).not.toBe(citation.section);
      }
    },
  );

  it('opens each step of a batch with its own prose, naming the movement as the tools print it', async () => {
    const leadIns: string[] = [];
    for (const [index, template] of CANARY_TEMPLATES.entries()) {
      const { agent } = modelsFor(template, pacing(seededRandom(index + 1)));
      const { amount, at } = template.seed.movement;
      const opening = textOf((await agent.doGenerate(CALL)).content);
      const lookup = textOf((await agent.doGenerate(CALL)).content);
      for (const leadIn of [opening, lookup]) {
        expect(leadIn).toContain(amount);
        expect(leadIn).toContain(at);
        leadIns.push(leadIn);
      }
    }
    expect(new Set(leadIns).size).toBe(leadIns.length);
  });

  it('refuses a misread for a draft that does not print its figure', () => {
    const { seed } = TEMPLATE!;
    expect(() =>
      misreadResolutionOf({ ...seed, draftReply: 'Hola, revisamos tu caso.' }),
    ).toThrow();
  });

  it('makes the calls investigationOf lists, step by step', async () => {
    const seed = 7;
    const { agent } = modelsFor(
      TEMPLATE,
      pacing(drawingFirst(NO_REPAIR_DRAW, seed)),
    );
    for (const step of investigationOf(TEMPLATE!.seed, seededRandom(seed))) {
      const { content } = await agent.doGenerate(CALL);
      expect(textOf(content)).toBe(step.leadIn);
      expect(
        toolCallsOf(content).map(({ tool, input }) => ({ tool, input })),
      ).toEqual(step.calls);
    }
  });

  it.each(CANARY_TEMPLATES)(
    '$defect answers its resolution once the investigation is done, again on any later call',
    async (template) => {
      const { agent } = modelsFor(
        template,
        pacing(drawingFirst(NO_REPAIR_DRAW)),
      );
      await agent.doGenerate(CALL);
      await agent.doGenerate(CALL);
      const final = await agent.doGenerate(CALL);
      expect(final.finishReason.unified).toBe('stop');
      expect(ResolutionSchema.parse(JSON.parse(textOf(final.content)))).toEqual(
        resolutionOf(template.seed),
      );
      expect(textOf((await agent.doGenerate(CALL)).content)).toBe(
        textOf(final.content),
      );
    },
  );

  it.each(CANARY_TEMPLATES)(
    '$defect answers first with a misread amount on a drawn run, then its resolution on the repair turn',
    async (template) => {
      const { agent } = modelsFor(template, pacing(drawingFirst(REPAIR_DRAW)));
      await agent.doGenerate(CALL);
      await agent.doGenerate(CALL);
      const first = textOf((await agent.doGenerate(CALL)).content);
      const repaired = textOf((await agent.doGenerate(CALL)).content);
      expect(JSON.parse(first)).toEqual(misreadResolutionOf(template.seed));
      expect(JSON.parse(repaired)).toEqual(resolutionOf(template.seed));
      expect(first).not.toBe(repaired);
    },
  );

  describe.each(AGENT_VARIANTS)('on variant %s', (variant) => {
    const real = REAL_RUNS[variant];

    it.each(CANARY_TEMPLATES)(
      "$defect repairs as often as the variant's real runs did, and never needs a second repair",
      async (template) => {
        const runs = await runsOf(template, variant);
        const share =
          runs.filter(({ validations }) => validations > 1).length /
          runs.length;
        expect(
          Math.abs(share - real.repairedRuns / real.runs),
        ).toBeLessThanOrEqual(REPAIR_SHARE_TOLERANCE);
        expect(
          Math.max(...runs.map(({ validations }) => validations)),
        ).toBeLessThanOrEqual(MAX_VALIDATIONS);
      },
    );

    it.each(CANARY_TEMPLATES)(
      "$defect keeps its run totals and step counts inside the variant's real runs' envelope",
      async (template) => {
        const runs = await runsOf(template, variant);
        expectWithin(
          runs.map(({ inputTokens }) => inputTokens),
          real.inputTokens,
        );
        expectWithin(
          runs.map(({ outputTokens }) => outputTokens),
          real.outputTokens,
        );
        expectWithin(
          runs.map(({ latencyMs }) => latencyMs),
          real.latencyMs,
        );
        expectWithin(
          runs.map(({ costUsd }) => costUsd),
          real.costUsd,
        );
        expectWithin(
          runs.map(({ steps }) => steps),
          real.steps,
        );
        expectWithin(
          runs.map(({ toolCalls }) => toolCalls),
          real.toolCalls,
        );
      },
    );

    it("reports each call's input tokens from what it reads anew, as the variant's real calls did", async () => {
      const lines = real.promptTokens;
      for (let seed = 1; seed <= CONVERSATIONS; seed++) {
        const text = caseTextOf(TEMPLATE!);
        const charsPerResult = seed * READ_CHARS.get_customer!;
        const { redactor, agent } = modelsFor(
          TEMPLATE,
          pacing(drawingFirst(REPAIR_DRAW, seed)),
          variant,
        );
        const redaction = await redactor.doGenerate({
          prompt: opening(asCustomerData(text)),
        });
        expectOnLine(
          lines.redactor,
          asCustomerData(text).length,
          inputOf(redaction),
        );

        let prompt = opening(caseMessage(text));
        let previous = await agent.doGenerate({ prompt });
        expectOnLine(
          lines.caseMessage,
          caseMessage(text).length,
          inputOf(previous),
        );
        for (let step = 0; step < 2; step++) {
          const results = resultsOf(previous, () => charsPerResult);
          prompt = [...prompt, answered(previous), results];
          const next = await agent.doGenerate({ prompt });
          expectOnLine(
            lines.toolResults,
            charsPerResult * results.content.length,
            inputOf(next) - inputOf(previous) - outputOf(previous),
          );
          previous = next;
        }
        const repaired = await agent.doGenerate({
          prompt: [...prompt, answered(previous), REPAIR],
        });
        expect(inputOf(repaired) - inputOf(previous) - outputOf(previous)).toBe(
          UNGROUNDED_REPAIR_TOKENS,
        );
      }
    });
  });

  it.each(AGENT_VARIANTS)(
    "spreads variant %s's opening residuals like the real calls', tails included",
    async (variant) => {
      const line = REAL_RUNS[variant].promptTokens.caseMessage;
      const prompt = opening(caseMessage(caseTextOf(TEMPLATE!)));
      const chars = caseMessage(caseTextOf(TEMPLATE!)).length;
      const residuals: number[] = [];
      for (let seed = 1; seed <= OPENINGS; seed++) {
        const { agent } = modelsFor(
          TEMPLATE,
          pacing(seededRandom(seed)),
          variant,
        );
        const call = await agent.doGenerate({ prompt });
        residuals.push(inputOf(call) - (line.base + line.perChar * chars));
      }
      const share = (inTail: (residual: number) => boolean) =>
        residuals.filter(inTail).length / residuals.length;
      expect(
        Math.abs(share((r) => r < line.residual.q1 - ROUNDING) - TAIL_SHARE),
      ).toBeLessThanOrEqual(TAIL_TOLERANCE);
      expect(
        Math.abs(share((r) => r > line.residual.q3 + ROUNDING) - TAIL_SHARE),
      ).toBeLessThanOrEqual(TAIL_TOLERANCE);
    },
  );

  it('stamps request and tool call ids in the provider shapes, fresh on every call', async () => {
    const { requestIds, toolCallIds } = await scriptedRun(
      TEMPLATE!,
      seededRandom(3),
    );
    for (const id of requestIds) expect(id).toMatch(REQUEST_ID);
    for (const id of toolCallIds) expect(id).toMatch(TOOL_CALL_ID);
    expect(new Set(requestIds).size).toBe(requestIds.length);
    expect(new Set(toolCallIds).size).toBe(toolCallIds.length);
  });

  it('makes the redactor find nothing in the canary text', async () => {
    const { redactor } = modelsFor();
    const { content } = await redactor.doGenerate(CALL);
    expect(JSON.parse(textOf(content))).toEqual({ spans: [] });
  });

  it('keeps the agent and the redactor apart when both run on the same model id', async () => {
    const { agent, redactor } = modelsFor(
      TEMPLATE,
      pacing(seededRandom(1)),
      'B',
    );
    expect(agent.modelId).toBe(HAIKU_MODEL);
    expect(redactor.modelId).toBe(HAIKU_MODEL);
    expect(
      toolCallsOf((await agent.doGenerate(CALL)).content).map(
        ({ tool }) => tool,
      ),
    ).toEqual(['get_customer', 'list_transactions']);
  });

  it('takes time and reports tokens the way a provider call does, growing with the conversation', async () => {
    const paced = pacing(seededRandom(1));
    const { agent } = modelsFor(TEMPLATE, paced);
    const prompt = opening(caseMessage(caseTextOf(TEMPLATE!)));
    const first = await agent.doGenerate({ prompt });
    const second = await agent.doGenerate({
      prompt: [...prompt, answered(first), resultsOf(first)],
    });
    expect(paced.slept.every((ms) => ms > 0)).toBe(true);
    expect(second.usage.inputTokens.total!).toBeGreaterThan(
      first.usage.inputTokens.total! + first.usage.outputTokens.total!,
    );
    expect(agent.modelId).toBe(SONNET_MODEL);
    expect(agent.provider).toBe('anthropic.messages');
  });

  it('reads nothing from a prompt cache, as the agent sets none (no cacheControl)', async () => {
    const { agent, redactor } = modelsFor();
    for (const model of [redactor, agent, agent, agent]) {
      const { usage } = await model.doGenerate(CALL);
      expect(usage.inputTokens.cacheRead).toBe(0);
      expect(usage.inputTokens.noCache).toBe(usage.inputTokens.total);
    }
  });

  it('builds a fresh script on every call, so each run replays the investigation', async () => {
    const once = modelsFor();
    await once.agent.doGenerate(CALL);
    expect(
      toolCallsOf((await modelsFor().agent.doGenerate(CALL)).content).map(
        ({ tool }) => tool,
      ),
    ).toEqual(['get_customer', 'list_transactions']);
  });

  it('paces each call like a provider call by default', async () => {
    const { redactor } = canaryModelsOf(TEMPLATE!, {
      variant: 'A',
      modelId: SONNET_MODEL,
      redactorModelId: HAIKU_MODEL,
    });
    const started = performance.now();
    await redactor.doGenerate(CALL);
    expect(performance.now() - started).toBeGreaterThanOrEqual(
      SHORTEST_REDACTOR_MS - TIMER_SLACK_MS,
    );
  });
});

describe('assertCanaryCalibration (02 G3)', () => {
  it.each(AGENT_VARIANTS)(
    'lets variant %s run canaries on the models its real runs measured',
    (variant) => {
      expect(() =>
        assertCanaryCalibration({
          variant,
          modelId: REAL_RUNS[variant].model,
          redactorModelId: REAL_RUNS[variant].redactorModel,
        }),
      ).not.toThrow();
    },
  );

  it("refuses an agent model the variant's real runs did not run on", () => {
    expect(() =>
      assertCanaryCalibration({
        variant: 'A',
        modelId: HAIKU_MODEL,
        redactorModelId: REAL_RUNS.A.redactorModel,
      }),
    ).toThrow(/variant A/);
  });

  it("refuses a redactor model the variant's real runs did not run with", () => {
    expect(() =>
      assertCanaryCalibration({
        variant: 'B',
        modelId: REAL_RUNS.B.model,
        redactorModelId: SONNET_MODEL,
      }),
    ).toThrow(/variant B/);
  });
});
