import type { ActionType, Transaction } from '@fintech-agent/contracts';

import { shapeViolation, type G2Violation } from '../actions/allowed.js';
import { pastSpeiWindow } from '../actions/spei-window.js';

/** Why an approved action may no longer execute, besides a G2 row violation. */
export const REVALIDATION_FAILURES = [
  'missing',
  'not_owned',
  'spei_window',
] as const;
export type RevalidationFailure =
  (typeof REVALIDATION_FAILURES)[number] | G2Violation;

/**
 * Re-checks an approved action against core data read just now (02 G2, G3):
 * every transaction exists, belongs to the case's customer, fits the action's
 * G2 row, and a SPEI dispute is past the policy window. Null means execute;
 * a G2 failure names the rule it broke.
 */
export function revalidate(
  action: { type: ActionType; transaction_ids: readonly string[] },
  customerId: string,
  transactions: readonly (Transaction | null)[],
  now: Date,
): RevalidationFailure | null {
  const found = transactions.filter(
    (transaction): transaction is Transaction => transaction !== null,
  );
  if (found.length !== action.transaction_ids.length) return 'missing';
  if (found.some(({ customer_id }) => customer_id !== customerId)) {
    return 'not_owned';
  }
  const violation = shapeViolation(action.type, found);
  if (violation) return violation;
  if (
    action.type === 'open_dispute' &&
    found.some(
      (transaction) =>
        transaction.type === 'spei_out' &&
        !pastSpeiWindow(transaction.settled_at, now),
    )
  ) {
    return 'spei_window';
  }
  return null;
}
