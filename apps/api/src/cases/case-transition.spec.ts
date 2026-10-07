import { CASE_STATUSES } from '@fintech-agent/contracts';
import { describe, expect, it } from 'vitest';

import { MAX_MANUAL_RERUNS, rerunTarget } from './case-transition.js';

const RERUNNABLE = new Set(['needs_review', 'failed', 'resolved']);

describe('rerunTarget (02 G3 re-runs)', () => {
  it.each(CASE_STATUSES)('from %s', (status) => {
    expect(rerunTarget(status, 0)).toBe(
      RERUNNABLE.has(status) ? 'queued' : null,
    );
  });

  it('allows the third re-run and refuses the fourth', () => {
    expect(MAX_MANUAL_RERUNS).toBe(3);
    expect(rerunTarget('resolved', MAX_MANUAL_RERUNS - 1)).toBe('queued');
    expect(rerunTarget('resolved', MAX_MANUAL_RERUNS)).toBeNull();
  });
});
