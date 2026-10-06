import { z } from 'zod';

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
  'ungrounded_number',
  'commitment_language',
  'policy_data_conflict',
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

export const CitationSchema = z.strictObject({
  chunk_id: z.string().min(1),
  doc_id: z.string().min(1),
  section: z.string().min(1),
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

const decisionBase = {
  operator: z.string().min(1),
  final_reply: z.string().min(1),
  acknowledged_flags: z.array(z.enum(CASE_FLAGS)),
};

export const DecisionSchema = z.discriminatedUnion('decision', [
  z.strictObject({ ...decisionBase, decision: z.literal('approve') }),
  z.strictObject({
    ...decisionBase,
    decision: z.literal('reject'),
    reject_code: z.enum(REJECT_CODES),
    reject_reason: z.string().optional(),
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
