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
