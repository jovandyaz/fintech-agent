import { ACTION_TYPES } from '@fintech-agent/contracts';
import { describe, expect, it } from 'vitest';

import { reviewTierOf } from './review-tier.js';

const ALWAYS_HIGH = new Set(['open_dispute', 'escalate_fraud']);

describe('reviewTierOf (01 cases.review_tier)', () => {
  it.each(ACTION_TYPES)('sets the tier of %s with no flags', (type) => {
    expect(reviewTierOf(type, [])).toBe(
      ALWAYS_HIGH.has(type) ? 'high' : 'standard',
    );
  });

  it('raises any action to high when a flag is set', () => {
    expect(reviewTierOf('none', ['action_fact_mismatch'])).toBe('high');
    expect(reviewTierOf('resend_cep', ['fallback'])).toBe('high');
  });
});
