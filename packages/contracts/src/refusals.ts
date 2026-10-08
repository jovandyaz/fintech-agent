/** The refusals every domain operation shares; each adds its own. */
export const REFUSAL = {
  notFound: 'not_found',
  conflict: 'conflict',
} as const;

/** Why a decision was refused, the `message` of its error answer (02 G3). */
export const DECISION_FAILURE = {
  ...REFUSAL,
  invalidReply: 'invalid_reply',
  piiInRejectReason: 'pii_in_reject_reason',
  flagsNotAcknowledged: 'flags_not_acknowledged',
  overrideNotAllowed: 'override_not_allowed',
  transactionsNotReviewed: 'transactions_not_reviewed',
  coreUnavailable: 'core_unavailable',
} as const;
export type DecisionFailure =
  (typeof DECISION_FAILURE)[keyof typeof DECISION_FAILURE];

/** Why a re-run was refused, the `message` of its error answer (02 G3). */
export const RERUN_FAILURE = REFUSAL;
export type RerunFailure = (typeof RERUN_FAILURE)[keyof typeof RERUN_FAILURE];
