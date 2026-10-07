import type { LanguageModelUsage } from 'ai';

const CACHE_READ_FALLBACK_MULTIPLIER = 0.1;
const CACHE_WRITE_FALLBACK_MULTIPLIER = 1.25;

/** USD per token for one model; cache rates are optional. */
export interface ModelPricing {
  readonly inputCostPerToken?: number | undefined;
  readonly outputCostPerToken?: number | undefined;
  readonly cacheReadInputTokenCost?: number | undefined;
  readonly cacheCreationInputTokenCost?: number | undefined;
}

export interface TokenCostInput {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens?: number | undefined;
  readonly cacheWriteTokens?: number | undefined;
}

/**
 * Returns the USD cost of a completion. Cache token rates come from the
 * pricing entry when present, otherwise fall back to multiplying the base
 * input rate (Anthropic's published cache ratios).
 */
export function computeTokenCostUsd(
  input: TokenCostInput,
  pricing: ModelPricing,
): number {
  const inputRate = pricing.inputCostPerToken ?? 0;
  const outputRate = pricing.outputCostPerToken ?? 0;
  const cacheReadRate =
    pricing.cacheReadInputTokenCost ??
    inputRate * CACHE_READ_FALLBACK_MULTIPLIER;
  const cacheWriteRate =
    pricing.cacheCreationInputTokenCost ??
    inputRate * CACHE_WRITE_FALLBACK_MULTIPLIER;
  const inputTokens = Math.max(0, input.inputTokens);
  const outputTokens = Math.max(0, input.outputTokens);
  const cacheRead = Math.max(0, input.cacheReadTokens ?? 0);
  const cacheWrite = Math.max(0, input.cacheWriteTokens ?? 0);
  const nonCached = Math.max(0, inputTokens - cacheRead - cacheWrite);
  return (
    nonCached * inputRate +
    cacheRead * cacheReadRate +
    cacheWrite * cacheWriteRate +
    outputTokens * outputRate
  );
}

/** Token counts summed over the steps of a run. */
export interface RunUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export const emptyUsage = (): RunUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

/** Adds one step's usage; a count the provider did not report adds zero. */
export const addUsage = (
  total: RunUsage,
  usage: LanguageModelUsage,
): RunUsage => ({
  inputTokens: total.inputTokens + (usage.inputTokens ?? 0),
  outputTokens: total.outputTokens + (usage.outputTokens ?? 0),
  cacheReadTokens:
    total.cacheReadTokens + (usage.inputTokenDetails.cacheReadTokens ?? 0),
  cacheWriteTokens:
    total.cacheWriteTokens + (usage.inputTokenDetails.cacheWriteTokens ?? 0),
});

/** The cost of one call's reported usage; a count not reported costs zero. */
export const usageCostUsd = (
  usage: LanguageModelUsage,
  pricing: ModelPricing,
): number =>
  computeTokenCostUsd(
    {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: usage.inputTokenDetails.cacheReadTokens,
      cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens,
    },
    pricing,
  );
