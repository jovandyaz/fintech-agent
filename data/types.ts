export const TX_TYPES = ['spei_in', 'spei_out', 'card_purchase'] as const;
export type TxType = (typeof TX_TYPES)[number];

export const TX_STATUSES = [
  'settled',
  'pending',
  'returned',
  'rejected',
] as const;
export type TxStatus = (typeof TX_STATUSES)[number];

export const CARD_CHANNELS = ['card_present', 'card_not_present'] as const;
export type CardChannel = (typeof CARD_CHANNELS)[number];

export const DECLINE_REASONS = [
  'insufficient_funds',
  '3ds_failed',
  'card_blocked_fraud',
  'expired_card',
] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

export const HOLD_REASONS = ['fraud_review'] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];

export const SPEI_RETURN_REASONS = [
  'cuenta_inexistente',
  'cuenta_bloqueada',
  'beneficiario_no_coincide',
] as const;
export type SpeiReturnReason = (typeof SPEI_RETURN_REASONS)[number];

export const SPEI_REJECT_REASONS = ['account_limit'] as const;
export type SpeiRejectReason = (typeof SPEI_REJECT_REASONS)[number];

export const KYC_LEVELS = ['N1', 'N2', 'N3'] as const;
export type KycLevel = (typeof KYC_LEVELS)[number];

export const CARD_STATUSES = ['active', 'blocked_fraud'] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

/** Core banking record. Holds full values; only core-mock serves them, and the MCP server masks them. */
export interface Customer {
  id: string;
  first_name: string;
  last_names: string;
  rfc: string;
  curp: string;
  email: string;
  phone: string;
  clabe: string;
  card_pan: string;
  card_status: CardStatus;
  kyc_level: KycLevel;
  account_status: 'active';
}

interface TxBase {
  id: string;
  customer_id: string;
  amount: number;
  created_at: string;
  status: TxStatus;
}

export interface SpeiTx extends TxBase {
  type: 'spei_in' | 'spei_out';
  counterparty_name: string;
  counterparty_clabe: string;
  tracking_key: string;
  numeric_reference: string;
  settled_at: string | null;
  hold_reason: HoldReason | null;
  return_reason: SpeiReturnReason | null;
  returned_at: string | null;
  reversal_credit_id: string | null;
  reverses_tx_id: string | null;
  reject_reason: SpeiRejectReason | null;
  cep_available: boolean;
}

export interface CardTx extends TxBase {
  type: 'card_purchase';
  merchant_descriptor: string;
  merchant_brand: string;
  channel: CardChannel;
  auth_factors: number;
  decline_reason: DeclineReason | null;
}

export type Transaction = SpeiTx | CardTx;

export interface WebhookFixture {
  event_id: string;
  ticket_id: string;
  customer_id: string;
  text: string;
  created_at: string;
}
