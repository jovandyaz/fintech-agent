import type {
  CardChannel,
  CardStatus,
  DeclineReason,
  HoldReason,
  KycLevel,
  SpeiRejectReason,
  SpeiReturnReason,
  TxStatus,
} from '@fintech-agent/contracts';

export {
  TX_TYPES,
  TX_STATUSES,
  CARD_CHANNELS,
  DECLINE_REASONS,
  HOLD_REASONS,
  SPEI_RETURN_REASONS,
  SPEI_REJECT_REASONS,
  KYC_LEVELS,
  CARD_STATUSES,
  type TxType,
  type TxStatus,
  type CardChannel,
  type DeclineReason,
  type HoldReason,
  type SpeiReturnReason,
  type SpeiRejectReason,
  type KycLevel,
  type CardStatus,
} from '@fintech-agent/contracts';

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
