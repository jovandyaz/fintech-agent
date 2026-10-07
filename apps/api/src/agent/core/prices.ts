import type { ModelPricing } from './cost.js';

/**
 * Haiku 5.5 costs more above this many prompt tokens and the table holds the
 * lower tier, so no single call may be priced from it past this size.
 */
export const PRICED_PROMPT_TOKENS_MAX = 100_000;

/** The Sonnet-class model of variant A. */
export const SONNET_MODEL = 'claude-sonnet-5-5';
/** The Haiku-class model of variant B and the redactor. */
export const HAIKU_MODEL = 'claude-haiku-5-5';

const PRICES: ReadonlyMap<string, Required<ModelPricing>> = new Map([
  [
    SONNET_MODEL,
    {
      inputCostPerToken: 2e-6,
      outputCostPerToken: 10e-6,
      cacheReadInputTokenCost: 0.2e-6,
      cacheCreationInputTokenCost: 2.5e-6,
    },
  ],
  [
    HAIKU_MODEL,
    {
      inputCostPerToken: 0.1e-6,
      outputCostPerToken: 0.5e-6,
      cacheReadInputTokenCost: 0.01e-6,
      cacheCreationInputTokenCost: 0.125e-6,
    },
  ],
]);

/** The model ids the table prices; config accepts no other. */
export const PRICED_MODELS = [SONNET_MODEL, HAIKU_MODEL] as const;

/**
 * The price of a configured model id, as published on 2026-10-07 at
 * https://platform.claude.com/docs/en/about-claude/pricing, with cache writes
 * at the 5-minute rate (a 1-hour cache write costs more); throws for a model
 * the table lacks.
 */
export function pricingOf(model: string): Required<ModelPricing> {
  const pricing = PRICES.get(model);
  if (pricing === undefined) {
    throw new Error(`No price for model ${model}`);
  }
  return pricing;
}
