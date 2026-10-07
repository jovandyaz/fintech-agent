import { ACTION_STATUSES, type ActionStatus } from '@fintech-agent/contracts';
import { describe, expect, it } from 'vitest';

import { ACTION_EVENTS, transition, type ActionEvent } from './transition.js';

// Written from the 02 G3 diagram, independently of the implementation.
function expected(
  from: ActionStatus,
  event: ActionEvent,
  canary: boolean,
): ActionStatus | null {
  if (from === 'proposed') {
    if (event === 'approve') return canary ? 'canary_missed' : 'approved';
    if (event === 'reject') return canary ? 'canary_caught' : 'rejected';
    if (event === 'supersede') return 'superseded';
  }
  if (from === 'approved' && !canary) {
    if (event === 'execute') return 'executed';
    if (event === 'fail') return 'failed';
  }
  return null;
}

const cases = ACTION_STATUSES.flatMap((from) =>
  ACTION_EVENTS.flatMap((event) =>
    [false, true].map((canary) => ({ from, event, canary })),
  ),
);

describe('transition (02 G3)', () => {
  it.each(cases)(
    '$from --$event--> (canary: $canary)',
    ({ from, event, canary }) => {
      expect(transition(from, event, canary)).toBe(
        expected(from, event, canary),
      );
    },
  );
});
