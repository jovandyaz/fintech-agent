import type { LanguageModelUsage } from 'ai';
import { describe, expect, it } from 'vitest';

import {
  type RunUsage,
  addUsage,
  computeTokenCostUsd,
  emptyUsage,
} from './cost.js';

const SONNET = {
  inputCostPerToken: 0.000003,
  outputCostPerToken: 0.000015,
  cacheReadInputTokenCost: 3e-7,
  cacheCreationInputTokenCost: 0.00000375,
};

describe('computeTokenCostUsd', () => {
  it('prices plain input and output tokens', () => {
    const cost = computeTokenCostUsd(
      { inputTokens: 1000, outputTokens: 500 },
      SONNET,
    );
    expect(cost).toBeCloseTo(1000 * 0.000003 + 500 * 0.000015, 10);
  });

  it('uses catalog cache rates when present', () => {
    const cost = computeTokenCostUsd(
      {
        inputTokens: 1000,
        outputTokens: 0,
        cacheReadTokens: 600,
        cacheWriteTokens: 100,
      },
      SONNET,
    );
    expect(cost).toBeCloseTo(
      300 * 0.000003 + 600 * 3e-7 + 100 * 0.00000375,
      10,
    );
  });

  it('falls back to input-rate multipliers when cache rates are missing', () => {
    const cost = computeTokenCostUsd(
      {
        inputTokens: 1000,
        outputTokens: 0,
        cacheReadTokens: 500,
        cacheWriteTokens: 200,
      },
      { inputCostPerToken: 0.000003, outputCostPerToken: 0.000015 },
    );
    expect(cost).toBeCloseTo(
      300 * 0.000003 + 500 * 0.000003 * 0.1 + 200 * 0.000003 * 1.25,
      10,
    );
  });

  it('never prices negative non-cached tokens', () => {
    const cost = computeTokenCostUsd(
      { inputTokens: 100, outputTokens: 0, cacheReadTokens: 500 },
      SONNET,
    );
    expect(cost).toBeCloseTo(500 * 3e-7, 10);
  });

  it('clamps negative input tokens to zero', () => {
    const cost = computeTokenCostUsd(
      { inputTokens: -100, outputTokens: 500 },
      SONNET,
    );
    expect(cost).toBeCloseTo(500 * 0.000015, 10);
  });

  it('clamps negative output tokens to zero', () => {
    const cost = computeTokenCostUsd(
      { inputTokens: 1000, outputTokens: -500 },
      SONNET,
    );
    expect(cost).toBeCloseTo(1000 * 0.000003, 10);
  });

  it('returns zero when the entry has no per-token rates', () => {
    expect(
      computeTokenCostUsd({ inputTokens: 1000, outputTokens: 1000 }, {}),
    ).toBe(0);
  });
});

const usage = (
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  cacheReadTokens?: number,
  cacheWriteTokens?: number,
): LanguageModelUsage => ({
  inputTokens,
  inputTokenDetails: {
    noCacheTokens: undefined,
    cacheReadTokens,
    cacheWriteTokens,
  },
  outputTokens,
  outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
  totalTokens: undefined,
});

describe('addUsage', () => {
  it('adds every step of a run, cache reads and writes included', () => {
    const total: RunUsage = [
      usage(1000, 200, 600, 100),
      usage(500, 50, 400, undefined),
    ].reduce(addUsage, emptyUsage());
    expect(total).toEqual({
      inputTokens: 1500,
      outputTokens: 250,
      cacheReadTokens: 1000,
      cacheWriteTokens: 100,
    });
  });

  it('counts a usage the provider did not report as zero', () => {
    expect(addUsage(emptyUsage(), usage(undefined, undefined))).toEqual(
      emptyUsage(),
    );
  });
});
