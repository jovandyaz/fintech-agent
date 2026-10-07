import { z } from 'zod';

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

export const SPEI_TYPES = ['spei_in', 'spei_out'] as const;
export const ACCOUNT_STATUSES = ['active'] as const;

/** Core banking customer with full values. Only core-mock serves it; the MCP server masks it before anything leaves. */
export const CustomerRecordSchema = z.object({
  id: z.string().min(1),
  first_name: z.string(),
  last_names: z.string(),
  rfc: z.string(),
  curp: z.string(),
  email: z.string(),
  phone: z.string(),
  clabe: z.string(),
  card_pan: z.string(),
  card_status: z.enum(CARD_STATUSES),
  kyc_level: z.enum(KYC_LEVELS),
  account_status: z.enum(ACCOUNT_STATUSES),
});
export type Customer = z.infer<typeof CustomerRecordSchema>;

const txBase = {
  id: z.string().min(1),
  customer_id: z.string().min(1),
  amount: z.number(),
  created_at: z.string(),
  status: z.enum(TX_STATUSES),
};

export const SpeiTxRecordSchema = z.object({
  ...txBase,
  type: z.enum(SPEI_TYPES),
  counterparty_name: z.string(),
  counterparty_clabe: z.string(),
  tracking_key: z.string(),
  numeric_reference: z.string(),
  settled_at: z.string().nullable(),
  hold_reason: z.enum(HOLD_REASONS).nullable(),
  return_reason: z.enum(SPEI_RETURN_REASONS).nullable(),
  returned_at: z.string().nullable(),
  reversal_credit_id: z.string().nullable(),
  reverses_tx_id: z.string().nullable(),
  reject_reason: z.enum(SPEI_REJECT_REASONS).nullable(),
  cep_available: z.boolean(),
});
export type SpeiTx = z.infer<typeof SpeiTxRecordSchema>;

export const CardTxRecordSchema = z.object({
  ...txBase,
  type: z.literal('card_purchase'),
  merchant_descriptor: z.string(),
  merchant_brand: z.string(),
  channel: z.enum(CARD_CHANNELS),
  auth_factors: z.number().int(),
  decline_reason: z.enum(DECLINE_REASONS).nullable(),
});
export type CardTx = z.infer<typeof CardTxRecordSchema>;

export const TransactionRecordSchema = z.discriminatedUnion('type', [
  SpeiTxRecordSchema,
  CardTxRecordSchema,
]);
export type Transaction = z.infer<typeof TransactionRecordSchema>;

/** A page of core-mock's transaction list. */
export const CorePageSchema = z.object({
  items: z.array(TransactionRecordSchema),
  total: z.number().int(),
  next_cursor: z.string().nullable(),
});
export type CorePage = z.infer<typeof CorePageSchema>;
