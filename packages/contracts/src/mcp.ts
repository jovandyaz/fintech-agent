import { z } from 'zod';

import {
  CARD_CHANNELS,
  CARD_STATUSES,
  DECLINE_REASONS,
  HOLD_REASONS,
  KYC_LEVELS,
  SPEI_REJECT_REASONS,
  SPEI_RETURN_REASONS,
  TX_STATUSES,
  TX_TYPES,
} from './core.js';

export const CASE_TOKEN_ISSUER = 'case-copilot-api';
export const CASE_TOKEN_SCOPE = 'case:read';
export const CASE_TOKEN_MAX_TTL_S = 600;
export const CASE_TOKEN_MAX_CALLS = 12;

/** Claims of the case token the harness mints and the MCP server verifies (02 G4). `sub` is the customer id. */
export const CaseTokenClaimsSchema = z.object({
  iss: z.literal(CASE_TOKEN_ISSUER),
  aud: z.string().min(1),
  sub: z.string().min(1),
  case_id: z.string().min(1),
  run_id: z.string().min(1),
  jti: z.string().min(1),
  scope: z.literal(CASE_TOKEN_SCOPE),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type CaseTokenClaims = z.infer<typeof CaseTokenClaimsSchema>;

/** `tools/list` order is part of the prompt and of `prompt_version`, so it is fixed (01 §Tools). */
export const MCP_TOOL_NAMES = [
  'get_customer',
  'list_transactions',
  'get_spei_status',
  'get_card_authorization',
] as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

export const MCP_TOOL_ERRORS = [
  'NOT_FOUND',
  'WRONG_TYPE',
  'RATE_LIMITED',
  'UPSTREAM_UNAVAILABLE',
  'INTERNAL',
] as const;
export type McpToolError = (typeof MCP_TOOL_ERRORS)[number];

export const MAX_LIST_LIMIT = 25;
const DEFAULT_LIST_LIMIT = 10;
const MAX_QUERY_CHARS = 64;

const isoInstant = z.union([z.iso.datetime({ offset: true }), z.iso.date()]);
const transactionId = z.string().min(1).max(MAX_QUERY_CHARS);

export const ListTransactionsInputSchema = z.strictObject({
  type: z.enum(TX_TYPES).optional(),
  status: z.enum(TX_STATUSES).optional(),
  from: isoInstant.optional(),
  to: isoInstant.optional(),
  min_amount: z.number().nonnegative().optional(),
  max_amount: z.number().nonnegative().optional(),
  query: z.string().min(1).max(MAX_QUERY_CHARS).optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIST_LIMIT)
    .default(DEFAULT_LIST_LIMIT),
  cursor: z.string().regex(/^\d+$/).optional(),
});

export const TransactionLookupInputSchema = z.strictObject({
  transaction_id: transactionId,
});

export const CustomerViewSchema = z.strictObject({
  first_name: z.string(),
  account_status: z.string(),
  kyc_level: z.enum(KYC_LEVELS),
  clabe: z.string(),
  card_last4: z.string(),
  card_status: z.enum(CARD_STATUSES),
});
export type CustomerView = z.infer<typeof CustomerViewSchema>;

const rowBase = {
  id: z.string(),
  status: z.enum(TX_STATUSES),
  amount: z.number(),
  created_at: z.string(),
};

export const TransactionRowSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...rowBase,
    type: z.literal('card_purchase'),
    merchant_descriptor: z.string(),
    channel: z.enum(CARD_CHANNELS),
    auth_factors: z.number().int(),
  }),
  z.strictObject({
    ...rowBase,
    type: z.enum(['spei_in', 'spei_out']),
    counterparty_first_name: z.string(),
    counterparty_clabe: z.string(),
  }),
]);
export type TransactionRow = z.infer<typeof TransactionRowSchema>;

export const TransactionPageSchema = z.strictObject({
  items: z.array(TransactionRowSchema),
  total: z.number().int(),
  next_cursor: z.string().nullable(),
  truncated: z.boolean(),
});
export type TransactionPage = z.infer<typeof TransactionPageSchema>;

/** Only the last four of the SPEI tracking key leave the MCP server: no action needs it whole. */
export const SpeiStatusSchema = z.strictObject({
  ...rowBase,
  type: z.enum(['spei_in', 'spei_out']),
  settled_at: z.string().nullable(),
  returned_at: z.string().nullable(),
  tracking_key_last4: z.string(),
  return_reason: z.enum(SPEI_RETURN_REASONS).nullable(),
  hold_reason: z.enum(HOLD_REASONS).nullable(),
  reject_reason: z.enum(SPEI_REJECT_REASONS).nullable(),
  reversal_credit_id: z.string().nullable(),
  cep_available: z.boolean(),
});
export type SpeiStatus = z.infer<typeof SpeiStatusSchema>;

export const CARD_DECISIONS = ['approved', 'declined'] as const;

/** `auth_factors` counts independent authentication factors; 3DS maps here. */
export const CardAuthorizationSchema = z.strictObject({
  ...rowBase,
  decision: z.enum(CARD_DECISIONS),
  decline_reason: z.enum(DECLINE_REASONS).nullable(),
  merchant_descriptor: z.string(),
  merchant_brand: z.string(),
  channel: z.enum(CARD_CHANNELS),
  auth_factors: z.number().int(),
});
export type CardAuthorization = z.infer<typeof CardAuthorizationSchema>;
