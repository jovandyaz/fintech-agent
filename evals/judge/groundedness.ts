import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ApiProvider, Assertion, ProviderOptions } from 'promptfoo';

import { NO_REPLY } from './text.js';

const RUBRIC_FILE = resolve(import.meta.dirname, 'groundedness.md');
const GROUNDEDNESS = 'groundedness';
/** The assertion type of the groundedness verdict: how every reader finds it among a result's assertions. */
export const RUBRIC_ASSERTION = 'llm-rubric';
const ANTHROPIC_MESSAGES = 'anthropic:messages:';
const JUDGE_ID = 'judge';
/** The reason a run that persisted no reply records instead of a verdict (03 §Judge validation). */
export const NOT_JUDGED =
  'not judged: the run persisted no reply, so there is nothing to ground (03 §Judge validation)';

// Opus 5.5 as published on 2026-10-08 at
// https://platform.claude.com/docs/en/about-claude/pricing; judge prompts are
// not cached, so input and output prices are all a run pays.
/** The judge models the price table holds: a run with any other could not report what it cost. */
export const PRICED_JUDGES = ['claude-opus-5-5'] as const;
const [OPUS_5_5] = PRICED_JUDGES;

const JUDGE_PRICES: ReadonlyMap<string, { input: number; output: number }> =
  new Map([[OPUS_5_5, { input: 4e-6, output: 20e-6 }]]);

/** The USD a judge's tokens cost; throws for a model the table lacks, so a run never reports an unpriced judge as free. */
export function judgeCostUsd(
  model: string,
  tokens: { promptTokens: number; completionTokens: number },
): number {
  const price = JUDGE_PRICES.get(model);
  if (!price) throw new Error(`No price for judge model ${model}`);
  return (
    tokens.promptTokens * price.input + tokens.completionTokens * price.output
  );
}

/** The committed rubric, frozen for a run (03 §Judge validation). */
export const groundednessRubric = (): string =>
  readFileSync(RUBRIC_FILE, 'utf8');

/** The judge as promptfoo calls it: `JUDGE_MODEL` at its default sampling, since Opus 5.5 accepts no temperature (03 §Judge validation). */
export const judgeProvider = (model: string): ProviderOptions => ({
  id: `${ANTHROPIC_MESSAGES}${model}`,
});

/** The judge of one test: promptfoo grades its `llm-rubric` with the test's `options.provider`. */
export type Grader = ApiProvider | ProviderOptions;

const isApiProvider = (grader: Grader): grader is ApiProvider =>
  typeof grader.id === 'function';

async function loadedJudge(grader: ProviderOptions): Promise<ApiProvider> {
  if (!grader.id) {
    throw new Error('a judge given by options names no provider id');
  }
  const { loadApiProvider } = await import('promptfoo');
  return loadApiProvider(grader.id, { options: grader });
}

/**
 * `grader`, which only ever reads a draft: promptfoo 0.124 hands the grader
 * the answer it grades as `vars.output`, and a run that persisted no reply
 * answers `NO_REPLY` (03 §Judge validation). That answer never reaches the
 * judge; it comes back as a grader error, which every reader takes as no
 * verdict, so the run is not judged and never passes.
 */
function draftsOnly(grader: Grader): ApiProvider {
  let judge: Promise<ApiProvider> | undefined;
  return {
    id: () => (isApiProvider(grader) ? grader.id() : (grader.id ?? JUDGE_ID)),
    callApi: async (prompt, context, options) => {
      if (context?.vars['output'] === NO_REPLY) return { error: NOT_JUDGED };
      judge ??= isApiProvider(grader)
        ? Promise.resolve(grader)
        : loadedJudge(grader);
      return (await judge).callApi(prompt, context, options);
    },
  };
}

/**
 * The test options that make `grader` the judge, behind `draftsOnly`.
 * promptfoo 0.124 deep-clones each test without cycle support before
 * grading, sparing only `options.provider`; an assertion-level provider
 * resolves to an SDK client whose references cycle and overflows that clone.
 */
export const judgedBy = (grader: Grader): { provider: ApiProvider } => ({
  provider: draftsOnly(grader),
});

/**
 * The groundedness `llm-rubric` over what the provider answered
 * (`judgeText`), graded by the test's judge (`judgedBy`). The rubric goes in
 * verbatim: promptfoo renders a string assertion value as a nunjucks
 * template over the test's vars, which would erase the `{{folio}}`
 * placeholders the rubric tells the judge about.
 */
export function groundednessAssertion(
  rubric: string = groundednessRubric(),
): Assertion {
  return {
    type: RUBRIC_ASSERTION,
    metric: GROUNDEDNESS,
    value: `{% raw %}${rubric}{% endraw %}`,
  };
}
