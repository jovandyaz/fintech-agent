import {
  MAX_ACTION_TRANSACTIONS,
  type ActionType,
  type Transaction,
} from '@fintech-agent/contracts';

export const G2_VIOLATIONS = [
  'transaction_count',
  'duplicate_transaction',
  'transaction_state',
] as const;
export type G2Violation = (typeof G2_VIOLATIONS)[number];

interface Row {
  min: number;
  max: number;
  allows: (transaction: Transaction) => boolean;
}

const isSettled = (transaction: Transaction): boolean =>
  transaction.status === 'settled';

/** The "Required transactions" and "Allowed when" columns of the 02 G2 table. */
const G2_TABLE: Record<ActionType, Row> = {
  open_dispute: {
    min: 1,
    max: 3,
    allows: (transaction) =>
      transaction.type === 'card_purchase'
        ? transaction.status === 'settled' || transaction.status === 'pending'
        : transaction.type === 'spei_out' && isSettled(transaction),
  },
  resend_cep: {
    min: 1,
    max: 1,
    allows: (transaction) =>
      transaction.type !== 'card_purchase' && isSettled(transaction),
  },
  escalate_fraud: { min: 0, max: MAX_ACTION_TRANSACTIONS, allows: () => true },
  none: { min: 0, max: 0, allows: () => true },
};

/**
 * Whether an action's transactions fit its G2 row. Ownership and the fact
 * predicates are checked by the caller; the SPEI policy window by the
 * executor's re-validation. Null means the shape is allowed.
 */
export function shapeViolation(
  type: ActionType,
  transactions: readonly Transaction[],
): G2Violation | null {
  const row = G2_TABLE[type];
  if (transactions.length < row.min || transactions.length > row.max) {
    return 'transaction_count';
  }
  if (new Set(transactions.map(({ id }) => id)).size !== transactions.length) {
    return 'duplicate_transaction';
  }
  return transactions.every(row.allows) ? null : 'transaction_state';
}
