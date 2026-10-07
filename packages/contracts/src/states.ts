const FAILED = 'failed';

/** `cases.status`; the row is also the queue's job (01 Webhook and queue). */
export const CASE_STATUSES = [
  'queued',
  'investigating',
  'needs_review',
  'resolved',
  FAILED,
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_SOURCES = ['webhook', 'console', 'eval'] as const;
export type CaseSource = (typeof CASE_SOURCES)[number];

/** Set by code at Persist, never from model self-confidence. */
export const REVIEW_TIERS = ['standard', 'high'] as const;
export type ReviewTier = (typeof REVIEW_TIERS)[number];

export const RUN_STATUSES = [
  'running',
  'succeeded',
  'fallback',
  FAILED,
  'abandoned',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const STOP_REASONS = [
  'completed',
  'budget',
  'validation',
  'agent_disabled',
  'error',
] as const;
export type StopReason = (typeof STOP_REASONS)[number];

export const STEP_KINDS = [
  'llm',
  'tool',
  'retrieval',
  'guard',
  'validation',
] as const;
export type StepKind = (typeof STEP_KINDS)[number];

/**
 * What a `guard` step records in `output_masked.outcome`; the redactor
 * degraded alert counts `degraded` (01 §Observability).
 */
export const GUARD_OUTCOMES = ['passed', 'flagged', 'degraded'] as const;
export type GuardOutcome = (typeof GUARD_OUTCOMES)[number];

/** Which role may move a row between these is enforced by a trigger (02 G1). */
export const ACTION_STATUSES = [
  'proposed',
  'approved',
  'executed',
  'rejected',
  FAILED,
  'superseded',
  'canary_caught',
  'canary_missed',
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const EXECUTION_STATUSES = ['started', 'executed', FAILED] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const SECURITY_EVENT_KINDS = ['cross_customer_lookup'] as const;
export type SecurityEventKind = (typeof SECURITY_EVENT_KINDS)[number];

/** Login roles of 02 G1; migrations run as the owner, never as one of these. */
export const DB_ROLES = [
  'copilot_api',
  'copilot_executor',
  'copilot_mcp',
] as const;
export type DbRole = (typeof DB_ROLES)[number];
