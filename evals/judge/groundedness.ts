import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ApiProvider, Assertion, ProviderOptions } from 'promptfoo';

const RUBRIC_FILE = resolve(import.meta.dirname, 'groundedness.md');
const GROUNDEDNESS = 'groundedness';
const DETERMINISTIC = 0;
const ANTHROPIC_MESSAGES = 'anthropic:messages:';

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

/** The judge as promptfoo calls it: `JUDGE_MODEL` at temperature 0 (03 §Judge validation). */
export const judgeProvider = (model: string): ProviderOptions => ({
  id: `${ANTHROPIC_MESSAGES}${model}`,
  config: { temperature: DETERMINISTIC },
});

/**
 * The groundedness `llm-rubric`, graded by `grader` over what the provider
 * answered (`judgeText`). The rubric goes in verbatim: promptfoo renders a
 * string assertion value as a nunjucks template over the test's vars, which
 * would erase the `{{folio}}` placeholders the rubric tells the judge about.
 */
export function groundednessAssertion(
  grader: ApiProvider | ProviderOptions,
  rubric: string = groundednessRubric(),
): Assertion {
  return {
    type: 'llm-rubric',
    metric: GROUNDEDNESS,
    provider: grader,
    value: `{% raw %}${rubric}{% endraw %}`,
  };
}
