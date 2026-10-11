import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ACTION_TYPES, maskPii } from '@fintech-agent/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { storedReadChars } from '../../test/read-chars.js';
import { PRICED_MODELS, pricingOf } from '../agent/core/prices.js';
import { asCustomerData, caseMessage } from '../agent/core/prompt.js';
import { AGENT_VARIANTS } from '../config.js';
import {
  REAL_RUNS,
  REAL_RUNS_FILE,
  REAL_STEPS_FILE,
  UNGROUNDED_REPAIR_TOKENS,
  type Lengths,
  type RealRuns,
  type Spread,
  type TokenLine,
} from './real-runs.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const QUARTERS = 4;
const PER_CHAR_DECIMALS = 4;
// cost_usd is stored to the micro-dollar.
const COST_SLACK_USD = 1e-6;
const UNGROUNDED_ONLY = JSON.stringify(['UNGROUNDED_NUMBER']);

// evals/provider.ts labels a variant's results so; api cannot import evals.
const providerOf = (variant: (typeof AGENT_VARIANTS)[number]): string =>
  `variant-${variant}`;

const AnswerSchema = z.object({
  reasoning_summary: z.string(),
  draft_reply: z.string(),
  proposed_action: z.object({ justification: z.string() }),
});
type Answer = z.infer<typeof AnswerSchema>;

const RunSchema = z.object({
  run_id: z.string(),
  model: z.string(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  latency_ms: z.number(),
  cost_usd: z.number(),
  steps: z.number(),
  tool_calls: z.array(z.unknown()),
  validations: z.array(z.unknown()),
  proposal: z.object({ type: z.enum(ACTION_TYPES) }),
  model_outputs: z.array(AnswerSchema),
});
type Run = z.infer<typeof RunSchema>;

const ResultsSchema = z.object({
  results: z.array(
    z.object({
      provider: z.object({ id: z.string() }),
      response: z.object({
        metadata: z.object({ run: RunSchema, customer_text: z.string() }),
      }),
    }),
  ),
});

const StepSchema = z.object({
  kind: z.string(),
  input_tokens: z.number().nullable(),
  output_tokens: z.number().nullable(),
  cost_usd: z.number().nullable(),
  output: z.unknown(),
  codes: z.array(z.string()).nullable(),
});
type Step = z.infer<typeof StepSchema>;

const StepsSchema = z.array(
  z.object({ run_id: z.string(), steps: z.array(StepSchema) }),
);

const readJson = (file: string): unknown =>
  JSON.parse(readFileSync(resolve(REPO_ROOT, file), 'utf8'));

const { results } = ResultsSchema.parse(readJson(REAL_RUNS_FILE));
const stepsOf = new Map(
  StepsSchema.parse(readJson(REAL_STEPS_FILE)).map(({ run_id, steps }) => [
    run_id,
    steps,
  ]),
);

type Point = readonly [chars: number, tokens: number];

// What each model call of one run read anew, as characters against input tokens.
interface Readings {
  redactor: Point & { costUsd: number; outputTokens: number };
  caseMessage: Point;
  toolResults: Point[];
  repairs: { codes: string; tokens: number }[];
}

function readingsOf(steps: readonly Step[], customerText: string): Readings {
  const masked = maskPii(customerText);
  const redaction = steps.find(
    ({ kind, input_tokens }) => kind === 'guard' && input_tokens !== null,
  )!;
  const calls = steps.filter(({ kind }) => kind === 'llm');
  const readings: Readings = {
    redactor: Object.assign(
      [asCustomerData(masked).length, redaction.input_tokens!] as const,
      { costUsd: redaction.cost_usd!, outputTokens: redaction.output_tokens! },
    ),
    caseMessage: [caseMessage(masked).length, calls[0]!.input_tokens!],
    toolResults: [],
    repairs: [],
  };
  let previous: Step | null = null;
  let chars = 0;
  let codes: string[] | null = null;
  for (const step of steps) {
    if (step.kind === 'tool' || step.kind === 'retrieval') {
      chars += storedReadChars(step.output);
    } else if (step.kind === 'validation') {
      codes = step.codes;
    } else if (step.kind === 'llm') {
      if (previous !== null) {
        const added =
          step.input_tokens! - previous.input_tokens! - previous.output_tokens!;
        if (chars > 0) readings.toolResults.push([chars, added]);
        else if (codes !== null) {
          readings.repairs.push({
            codes: JSON.stringify(codes),
            tokens: added,
          });
        }
      }
      previous = step;
      chars = 0;
      codes = null;
    }
  }
  return readings;
}

function lineOf(points: readonly Point[]): TokenLine {
  const mean = (values: readonly number[]) =>
    values.reduce((total, value) => total + value, 0) / values.length;
  const meanChars = mean(points.map(([chars]) => chars));
  const meanTokens = mean(points.map(([, tokens]) => tokens));
  const covariance = mean(
    points.map(
      ([chars, tokens]) => (chars - meanChars) * (tokens - meanTokens),
    ),
  );
  const variance = mean(points.map(([chars]) => (chars - meanChars) ** 2));
  const perChar = Number((covariance / variance).toFixed(PER_CHAR_DECIMALS));
  const base = Math.round(meanTokens - perChar * meanChars);
  const { min, q1, q3, max } = spreadOf(
    points.map(([chars, tokens]) => tokens - (base + perChar * chars)),
  );
  return {
    base,
    perChar,
    residual: {
      min: Math.round(min),
      q1: Math.round(q1),
      q3: Math.round(q3),
      max: Math.round(max),
    },
  };
}

// The priced model whose rates give every redaction call its stored cost.
function redactorModelOf(readings: readonly Readings[]): string {
  const [model, ...others] = PRICED_MODELS.filter((candidate) => {
    const { inputCostPerToken, outputCostPerToken } = pricingOf(candidate);
    return readings.every(
      ({ redactor }) =>
        Math.abs(
          redactor[1] * inputCostPerToken! +
            redactor.outputTokens * outputCostPerToken! -
            redactor.costUsd,
        ) <= COST_SLACK_USD,
    );
  });
  expect(others).toEqual([]);
  return model!;
}

function spreadOf(values: readonly number[]): Spread {
  const sorted = [...values].sort((a, b) => a - b);
  const quartile = (quarter: number) =>
    sorted[Math.floor((sorted.length * quarter) / QUARTERS)]!;
  return {
    min: sorted[0]!,
    q1: quartile(1),
    median: quartile(2),
    q3: quartile(3),
    max: sorted.at(-1)!,
  };
}

function lengthsOf(
  answers: readonly Answer[],
  text: (answer: Answer) => string,
): Lengths {
  const { min, median, max } = spreadOf(
    answers.map((answer) => text(answer).length),
  );
  return { min, median, max };
}

function measured(
  runs: readonly Run[],
  readings: readonly Readings[],
): RealRuns {
  const answers = runs.flatMap(({ model_outputs }) => model_outputs);
  return {
    model: runs[0]!.model,
    redactorModel: redactorModelOf(readings),
    runs: runs.length,
    inputTokens: spreadOf(runs.map(({ input_tokens }) => input_tokens)),
    outputTokens: spreadOf(runs.map(({ output_tokens }) => output_tokens)),
    latencyMs: spreadOf(runs.map(({ latency_ms }) => latency_ms)),
    costUsd: spreadOf(runs.map(({ cost_usd }) => cost_usd)),
    steps: spreadOf(runs.map(({ steps }) => steps)),
    toolCalls: spreadOf(runs.map(({ tool_calls }) => tool_calls.length)),
    repairedRuns: runs.filter(({ validations }) => validations.length > 1)
      .length,
    actions: Object.fromEntries(
      ACTION_TYPES.map((type) => [
        type,
        runs.filter(({ proposal }) => proposal.type === type).length,
      ]),
    ) as RealRuns['actions'],
    textChars: {
      reasoningSummary: lengthsOf(
        answers,
        ({ reasoning_summary }) => reasoning_summary,
      ),
      justification: lengthsOf(
        answers,
        ({ proposed_action }) => proposed_action.justification,
      ),
      draftReply: lengthsOf(answers, ({ draft_reply }) => draft_reply),
    },
    promptTokens: {
      redactor: lineOf(readings.map(({ redactor }) => redactor)),
      caseMessage: lineOf(readings.map(({ caseMessage }) => caseMessage)),
      toolResults: lineOf(readings.flatMap(({ toolResults }) => toolResults)),
    },
  };
}

const readingsOfResult = ({ response }: (typeof results)[number]): Readings => {
  const { run, customer_text } = response.metadata;
  const steps = stepsOf.get(run.run_id);
  if (steps === undefined) throw new Error(`no steps for ${run.run_id}`);
  return readingsOf(steps, customer_text);
};

describe('REAL_RUNS (02 G3)', () => {
  it.each(AGENT_VARIANTS)(
    'holds what the final eval run measured for variant %s, all on one model',
    (variant) => {
      const ofVariant = results.filter(
        ({ provider }) => provider.id === providerOf(variant),
      );
      const runs = ofVariant.map(({ response }) => response.metadata.run);
      expect(runs.every(({ model }) => model === runs[0]?.model)).toBe(true);
      expect(REAL_RUNS[variant]).toEqual(
        measured(runs, ofVariant.map(readingsOfResult)),
      );
    },
  );

  it('holds the steps of every run in the final eval run, and no other', () => {
    expect([...stepsOf.keys()].sort()).toEqual(
      results.map(({ response }) => response.metadata.run.run_id).sort(),
    );
  });

  it('adds the tokens every real repair for UNGROUNDED_NUMBER alone added', () => {
    const tokens = results
      .map(readingsOfResult)
      .flatMap(({ repairs }) => repairs)
      .filter(({ codes }) => codes === UNGROUNDED_ONLY)
      .map((repair) => repair.tokens);
    expect(tokens.length).toBeGreaterThan(0);
    expect(new Set(tokens)).toEqual(new Set([UNGROUNDED_REPAIR_TOKENS]));
  });
});
