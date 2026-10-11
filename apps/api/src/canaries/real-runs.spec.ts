import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ACTION_TYPES } from '@fintech-agent/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AGENT_VARIANTS } from '../config.js';
import {
  REAL_RUNS,
  REAL_RUNS_FILE,
  type Lengths,
  type RealRuns,
  type Spread,
} from './real-runs.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const QUARTERS = 4;

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
      response: z.object({ metadata: z.object({ run: RunSchema }) }),
    }),
  ),
});

const { results } = ResultsSchema.parse(
  JSON.parse(readFileSync(resolve(REPO_ROOT, REAL_RUNS_FILE), 'utf8')),
);

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

function measured(runs: readonly Run[]): RealRuns {
  const answers = runs.flatMap(({ model_outputs }) => model_outputs);
  return {
    model: runs[0]!.model,
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
  };
}

describe('REAL_RUNS (02 G3)', () => {
  it.each(AGENT_VARIANTS)(
    'holds what the final eval run measured for variant %s, all on one model',
    (variant) => {
      const runs = results
        .filter(({ provider }) => provider.id === providerOf(variant))
        .map(({ response }) => response.metadata.run);
      expect(runs.every(({ model }) => model === runs[0]?.model)).toBe(true);
      expect(REAL_RUNS[variant]).toEqual(measured(runs));
    },
  );
});
