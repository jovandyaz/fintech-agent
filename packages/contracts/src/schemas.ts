import { z } from 'zod';

import { registryIdPattern } from './ids.js';

export const CASE_CATEGORIES = [
  'spei_outgoing_not_received',
  'spei_incoming_not_credited',
  'unrecognized_card_charge',
  'card_purchase_declined',
  'general_inquiry',
  'out_of_scope_or_suspicious',
] as const;
export type CaseCategory = (typeof CASE_CATEGORIES)[number];

export const ACTION_TYPES = [
  'open_dispute',
  'resend_cep',
  'escalate_fraud',
  'none',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const REASON_CODES = [
  'unrecognized_charge',
  'spei_not_received_after_window',
  'beneficiary_missing_funds',
  'customer_requested_receipt',
  'suspected_card_fraud',
  'suspected_social_engineering',
  'third_party_data_request',
  'informational',
  'no_policy_support',
  'insufficient_information',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const EVIDENCE_KINDS = ['transaction', 'spei', 'card_auth'] as const;

export const CASE_FLAGS = [
  'injection_signal',
  'policy_data_conflict',
  'action_fact_mismatch',
  'first_party_signal',
  'abstained',
  'fallback',
] as const;
export type CaseFlag = (typeof CASE_FLAGS)[number];

export const REJECT_CODES = [
  'wrong_category',
  'wrong_action',
  'wrong_transactions',
  'wrong_policy_or_ungrounded',
  'missing_policy',
  'tone',
  'other',
] as const;
export type RejectCode = (typeof REJECT_CODES)[number];

/** The validator codes a reply fails on, the draft and the operator's final reply alike (02 G3, G5). */
export const REPLY_CHECK_CODES = [
  'PII_IN_REPLY',
  'LINK_IN_REPLY',
  'AUTH_FACTOR_REQUEST',
] as const;
export type ReplyCheckCode = (typeof REPLY_CHECK_CODES)[number];

/**
 * The only sentences in which a reply may name an authentication factor
 * (02 G5 AUTH_FACTOR_REQUEST), matched after case, accent and spacing are
 * normalized; the console offers them for insertion.
 */
export const APPROVED_FACTOR_WARNINGS = [
  'Nunca te pediremos tu NIP, tu CVV, tus contraseñas ni los códigos que recibes por SMS.',
  'No compartas tu NIP, tu CVV, tus contraseñas ni tus códigos con nadie, ni siquiera con nosotros.',
] as const;

/** Path ids the console sends; anything outside the registry format is a 400. */
export const ActionIdSchema = z.string().regex(registryIdPattern('act'));
export const CaseIdSchema = z.string().regex(registryIdPattern('case'));

const MAX_QUOTE_CHARS = 200;

/** `quote` is verbatim from the chunk; the validator checks it (CITATION_QUOTE_MISMATCH). */
export const CitationSchema = z.strictObject({
  chunk_id: z.string().min(1),
  doc_id: z.string().min(1),
  section: z.string().min(1),
  quote: z.string().min(1).max(MAX_QUOTE_CHARS),
});

export const EvidenceSchema = z.strictObject({
  kind: z.enum(EVIDENCE_KINDS),
  id: z.string().min(1),
});

/** G2: no amount, account, recipient or free-text instruction field exists. */
export const ProposedActionSchema = z.strictObject({
  type: z.enum(ACTION_TYPES),
  transaction_ids: z.array(z.string().min(1)),
  reason_code: z.enum(REASON_CODES),
  justification: z.string().min(1),
});
export type ProposedAction = z.infer<typeof ProposedActionSchema>;

/**
 * The agent's structured output. Structural only: allowed action/transaction
 * combinations, provenance and PII are checked by the validator, because
 * cross-field checks do not survive conversion to the provider's JSON Schema.
 */
export const ResolutionSchema = z.strictObject({
  category: z.enum(CASE_CATEGORIES),
  draft_reply: z.string().min(1),
  citations: z.array(CitationSchema),
  abstained: z.boolean(),
  evidence: z.array(EvidenceSchema),
  proposed_action: ProposedActionSchema,
  reasoning_summary: z.string().min(1),
});
export type Resolution = z.infer<typeof ResolutionSchema>;

/** What executes (`proposed_actions.params`, 01): the G2 fields besides the type, no values. */
export const ActionParamsSchema = ProposedActionSchema.pick({
  transaction_ids: true,
  reason_code: true,
});
export type ActionParams = z.infer<typeof ActionParamsSchema>;

/** The most transactions any action of the 02 G2 table names (`escalate_fraud`). */
export const MAX_ACTION_TRANSACTIONS = 5;

/** An operator's replacement action: the G2 fields only, no justification, no values. */
export const OverrideSchema = z.strictObject({
  type: z.enum(ACTION_TYPES),
  transaction_ids: z.array(z.string().min(1)).max(MAX_ACTION_TRANSACTIONS),
  reason_code: z.enum(REASON_CODES),
});
export type Override = z.infer<typeof OverrideSchema>;

/** Bounds what an operator sends, and with it the edit-ratio computation over the reply. */
export const MAX_REPLY_CHARS = 4000;
export const MAX_REJECT_REASON_CHARS = 1000;

const decisionBase = {
  final_reply: z.string().min(1).max(MAX_REPLY_CHARS),
  acknowledged_flags: z.array(z.enum(CASE_FLAGS)),
};

/**
 * G3: the operator is resolved from their token, never named in the body, so
 * the schema is strict and has no operator field.
 */
export const DecisionSchema = z.discriminatedUnion('decision', [
  z.strictObject({
    ...decisionBase,
    decision: z.literal('approve'),
    reviewed_transaction_ids: z
      .array(z.string().min(1))
      .max(MAX_ACTION_TRANSACTIONS),
    override: OverrideSchema.optional(),
  }),
  z.strictObject({
    ...decisionBase,
    decision: z.literal('reject'),
    reject_code: z.enum(REJECT_CODES),
    reject_reason: z.string().max(MAX_REJECT_REASON_CHARS).optional(),
  }),
]);
export type Decision = z.infer<typeof DecisionSchema>;

export const WebhookEventSchema = z.strictObject({
  event_id: z.string().min(1),
  ticket_id: z.string().min(1),
  customer_id: z.string().min(1),
  text: z.string().min(1),
  created_at: z.iso.datetime({ offset: true }),
});
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;
