import type { ActionStatus } from '@fintech-agent/contracts';

export const ACTION_EVENTS = [
  'approve',
  'reject',
  'supersede',
  'execute',
  'fail',
] as const;
export type ActionEvent = (typeof ACTION_EVENTS)[number];

type Moves = Partial<Record<ActionEvent, ActionStatus>>;

const REAL: Partial<Record<ActionStatus, Moves>> = {
  proposed: {
    approve: 'approved',
    reject: 'rejected',
    supersede: 'superseded',
  },
  approved: { execute: 'executed', fail: 'failed' },
};

// A canary is decided like a real proposal but can never reach the executor.
const CANARY: Partial<Record<ActionStatus, Moves>> = {
  proposed: {
    approve: 'canary_missed',
    reject: 'canary_caught',
    supersede: 'superseded',
  },
};

/**
 * The proposal state machine of 02 G3. Null means the move is refused; the
 * caller still applies it with a conditional update, and the G1 trigger
 * refuses it again in the database.
 */
export function transition(
  from: ActionStatus,
  event: ActionEvent,
  isCanary: boolean,
): ActionStatus | null {
  return (isCanary ? CANARY : REAL)[from]?.[event] ?? null;
}
