import {
  ACTION_TYPES,
  MAX_ACTION_TRANSACTIONS,
  type ActionType,
  type OverrideOption,
  type Transaction,
} from '@fintech-agent/contracts';

export const G2_VIOLATIONS = [
  'transaction_count',
  'duplicate_transaction',
  'transaction_state',
] as const;
export type G2Violation = (typeof G2_VIOLATIONS)[number];

/** The one card transaction type. */
export const CARD_PURCHASE = 'card_purchase' as const;
const SETTLED = 'settled';
/** Card statuses a dispute may name (02 G2): the charge reached the account. */
export const DISPUTABLE_CARD_STATUSES: ReadonlySet<string> = new Set([
  SETTLED,
  'pending',
]);

/** Whether a transaction or status output, if there is one, is settled. */
export const isSettled = <T extends { status: string }>(
  transaction: T | undefined,
): transaction is T => transaction?.status === SETTLED;

/** The fields of a transaction its G2 row reads, wherever it was read from. */
export type TransactionShape = Pick<Transaction, 'id' | 'type' | 'status'>;

interface Row {
  min: number;
  max: number;
  allows: (transaction: TransactionShape) => boolean;
}

const G2_TABLE: Record<ActionType, Row> = {
  open_dispute: {
    min: 1,
    max: 3,
    allows: (transaction) =>
      transaction.type === CARD_PURCHASE
        ? DISPUTABLE_CARD_STATUSES.has(transaction.status)
        : transaction.type === 'spei_out' && isSettled(transaction),
  },
  resend_cep: {
    min: 1,
    max: 1,
    allows: (transaction) =>
      transaction.type !== CARD_PURCHASE && isSettled(transaction),
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
  transactions: readonly TransactionShape[],
): G2Violation | null {
  return (
    countViolation(
      type,
      transactions.map(({ id }) => id),
    ) ?? stateViolation(type, transactions)
  );
}

/** The part of a G2 row that reads each transaction's type and status. */
export function stateViolation(
  type: ActionType,
  transactions: readonly TransactionShape[],
): G2Violation | null {
  return transactions.every(G2_TABLE[type].allows) ? null : 'transaction_state';
}

/**
 * What the override picker offers (02 G2): each action with its count bounds
 * and the transactions its row allows, so the console offers only what
 * `shapeViolation` would accept at decision time.
 */
export function overrideOptionsOf(
  transactions: readonly TransactionShape[],
): OverrideOption[] {
  return ACTION_TYPES.map((type) => {
    const { min, max, allows } = G2_TABLE[type];
    return {
      type,
      min,
      max,
      transaction_ids:
        max === 0 ? [] : transactions.filter(allows).map(({ id }) => id),
    };
  });
}

/** The part of a G2 row that needs only the ids: how many, and no repeats. */
export function countViolation(
  type: ActionType,
  transactionIds: readonly string[],
): G2Violation | null {
  const row = G2_TABLE[type];
  if (transactionIds.length < row.min || transactionIds.length > row.max) {
    return 'transaction_count';
  }
  return new Set(transactionIds).size === transactionIds.length
    ? null
    : 'duplicate_transaction';
}
