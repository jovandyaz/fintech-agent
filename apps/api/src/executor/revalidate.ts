import {
  SPEI_DISPUTE_AFTER_HOURS,
  type ActionType,
  type Transaction,
} from '@fintech-agent/contracts';

import { shapeViolation } from '../actions/allowed.js';

const MS_PER_HOUR = 3_600_000;
const SPEI_WINDOW_MS = SPEI_DISPUTE_AFTER_HOURS * MS_PER_HOUR;

/** Why an approved action may no longer execute; it is marked `failed` with it. */
export const REVALIDATION_FAILURES = [
  'missing',
  'not_owned',
  'shape',
  'spei_window',
] as const;
export type RevalidationFailure = (typeof REVALIDATION_FAILURES)[number];

const insideSpeiWindow = (transaction: Transaction, now: Date): boolean =>
  transaction.type === 'spei_out' &&
  (transaction.settled_at === null ||
    now.getTime() - Date.parse(transaction.settled_at) < SPEI_WINDOW_MS);

/**
 * Re-checks an approved action against core data read just now (02 G2, G3):
 * every transaction exists, belongs to the case's customer, fits the action's
 * G2 row, and a SPEI dispute is past the policy window. Null means execute.
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
  if (shapeViolation(action.type, found) !== null) return 'shape';
  if (
    action.type === 'open_dispute' &&
    found.some((transaction) => insideSpeiWindow(transaction, now))
  ) {
    return 'spei_window';
  }
  return null;
}
