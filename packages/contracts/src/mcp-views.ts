import {
  SPEI_TYPES,
  type CardTx,
  type SpeiTx,
  type Transaction,
} from './core.js';
import { maskPii } from './mask.js';
import type { CardAuthorization, SpeiStatus, TransactionRow } from './mcp.js';

/** The digits of a card number or a tracking key that may leave the MCP server. */
export const LAST_FOUR_DIGITS = 4;

const WHITESPACE = /\s+/;

const firstName = (fullName: string): string =>
  fullName.trim().split(WHITESPACE)[0] ?? '';

export const isSpeiRecord = (tx: Transaction): tx is SpeiTx =>
  (SPEI_TYPES as readonly string[]).includes(tx.type);

/** A core record as `list_transactions` returns it: masked CLABE, first name only. */
export function transactionRowOf(tx: Transaction): TransactionRow {
  const base = {
    id: tx.id,
    status: tx.status,
    amount: tx.amount,
    created_at: tx.created_at,
  };
  if (!isSpeiRecord(tx)) {
    return {
      ...base,
      type: tx.type,
      merchant_descriptor: tx.merchant_descriptor,
      channel: tx.channel,
      auth_factors: tx.auth_factors,
    };
  }
  return {
    ...base,
    type: tx.type,
    counterparty_first_name: firstName(tx.counterparty_name),
    counterparty_clabe: maskPii(tx.counterparty_clabe),
  };
}

/** A SPEI record as `get_spei_status` returns it: the tracking key's last four only. */
export function speiStatusOf(tx: SpeiTx): SpeiStatus {
  return {
    id: tx.id,
    type: tx.type,
    status: tx.status,
    amount: tx.amount,
    created_at: tx.created_at,
    settled_at: tx.settled_at,
    returned_at: tx.returned_at,
    tracking_key_last4: tx.tracking_key.slice(-LAST_FOUR_DIGITS),
    return_reason: tx.return_reason,
    hold_reason: tx.hold_reason,
    reject_reason: tx.reject_reason,
    reversal_credit_id: tx.reversal_credit_id,
    cep_available: tx.cep_available,
  };
}

/** A card record as `get_card_authorization` returns it; a rejected purchase was declined. */
export function cardAuthorizationOf(tx: CardTx): CardAuthorization {
  return {
    id: tx.id,
    status: tx.status,
    decision: tx.status === 'rejected' ? 'declined' : 'approved',
    decline_reason: tx.decline_reason,
    amount: tx.amount,
    created_at: tx.created_at,
    merchant_descriptor: tx.merchant_descriptor,
    merchant_brand: tx.merchant_brand,
    channel: tx.channel,
    auth_factors: tx.auth_factors,
  };
}
