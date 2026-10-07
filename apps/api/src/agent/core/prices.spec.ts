import { describe, expect, it } from 'vitest';

import { pricingOf } from './prices.js';

describe('pricingOf', () => {
  it('prices the Sonnet and Haiku models per token, cache rates included', () => {
    expect(pricingOf('claude-sonnet-5-5')).toEqual({
      inputCostPerToken: 2e-6,
      outputCostPerToken: 10e-6,
      cacheReadInputTokenCost: 0.2e-6,
      cacheCreationInputTokenCost: 2.5e-6,
    });
    expect(pricingOf('claude-haiku-5-5')).toEqual({
      inputCostPerToken: 0.1e-6,
      outputCostPerToken: 0.5e-6,
      cacheReadInputTokenCost: 0.01e-6,
      cacheCreationInputTokenCost: 0.125e-6,
    });
  });

  it('refuses a model with no price, so a run is never costed at zero', () => {
    expect(() => pricingOf('claude-unknown-1')).toThrow(/claude-unknown-1/);
  });

  it('refuses a key every object inherits', () => {
    expect(() => pricingOf('constructor')).toThrow(/constructor/);
  });
});
