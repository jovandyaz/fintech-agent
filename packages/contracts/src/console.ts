import { z } from 'zod';

import { TransactionRowSchema } from './mcp.js';
import {
  ACTION_TYPES,
  ActionParamsSchema,
  CASE_CATEGORIES,
  CASE_FLAGS,
  CitationSchema,
} from './schemas.js';
import {
  ACTION_STATUSES,
  CASE_STATUSES,
  REVIEW_TIERS,
  RUN_STATUSES,
  STEP_KINDS,
  STOP_REASONS,
} from './states.js';

// Every console DTO below is strict and built field by field: a canary must
// serialize exactly like a real case until it is decided (02 G3), so nothing
// that could set one apart (`is_canary`, ticket and event ids, audit or run
// timestamps) has a field to land in.

/** Whether the agent investigates new cases: on, off (kill switch), or without a key. */
export const AGENT_STATES = ['on', 'off', 'no_api_key'] as const;
export type AgentState = (typeof AGENT_STATES)[number];

/** `GET /me`: the signed-in operator. */
export const OperatorViewSchema = z.strictObject({ id: z.string() });
export type OperatorView = z.infer<typeof OperatorViewSchema>;

/** `GET /cases` query: eval cases stay hidden unless asked for (01). */
export const InboxQuerySchema = z.strictObject({
  include_eval: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});
export type InboxQuery = z.infer<typeof InboxQuerySchema>;

/** `GET /status`: what the console's banners show. */
export const StatusSchema = z.strictObject({ agent: z.enum(AGENT_STATES) });
export type Status = z.infer<typeof StatusSchema>;

const caseSummary = {
  case_id: z.string(),
  folio: z.string(),
  status: z.enum(CASE_STATUSES),
  review_tier: z.enum(REVIEW_TIERS).nullable(),
  flags: z.array(z.enum(CASE_FLAGS)),
  category: z.enum(CASE_CATEGORIES).nullable(),
  received_at: z.iso.datetime({ offset: true }),
};

/** One inbox row (`GET /cases`). */
export const InboxItemSchema = z.strictObject(caseSummary);
export type InboxItem = z.infer<typeof InboxItemSchema>;

/** One step of a run's trace, with its input and output as stored: masked (02 G6). */
export const StepViewSchema = z.strictObject({
  idx: z.number().int(),
  kind: z.enum(STEP_KINDS),
  name: z.string(),
  input: z.unknown(),
  output: z.unknown(),
  latency_ms: z.number().int().nullable(),
  cost_usd: z.string().nullable(),
});
export type StepView = z.infer<typeof StepViewSchema>;

/** One agent run on a case, with its trace. */
export const RunViewSchema = z.strictObject({
  run_id: z.string(),
  status: z.enum(RUN_STATUSES),
  stop_reason: z.enum(STOP_REASONS).nullable(),
  error_code: z.string().nullable(),
  model: z.string(),
  input_tokens: z.number().int(),
  output_tokens: z.number().int(),
  cost_usd: z.string(),
  latency_ms: z.number().int().nullable(),
  steps: z.array(StepViewSchema),
});
export type RunView = z.infer<typeof RunViewSchema>;

/** The agent's resolution for the case's latest proposal. */
export const ResolutionViewSchema = z.strictObject({
  category: z.enum(CASE_CATEGORIES),
  draft_reply: z.string(),
  citations: z.array(CitationSchema),
  abstained: z.boolean(),
  reasoning_summary: z.string(),
});
export type ResolutionView = z.infer<typeof ResolutionViewSchema>;

/** The case's open proposal, or its latest one; a canary's status tells only after the decision. */
export const ProposalViewSchema = z.strictObject({
  action_id: z.string(),
  type: z.enum(ACTION_TYPES),
  params: ActionParamsSchema,
  justification: z.string(),
  status: z.enum(ACTION_STATUSES),
});
export type ProposalView = z.infer<typeof ProposalViewSchema>;

/** One action an operator may override to, with the transactions its G2 row allows. */
export const OverrideOptionSchema = z.strictObject({
  type: z.enum(ACTION_TYPES),
  min: z.number().int(),
  max: z.number().int(),
  transaction_ids: z.array(z.string()),
});
export type OverrideOption = z.infer<typeof OverrideOptionSchema>;

/** What the override picker offers for an open proposal: the actions and the customer's transactions, masked. */
export const OverrideOptionsSchema = z.strictObject({
  actions: z.array(OverrideOptionSchema),
  transactions: z.array(TransactionRowSchema),
});
export type OverrideOptions = z.infer<typeof OverrideOptionsSchema>;

/**
 * `GET /cases/:caseId`. `case.text` is the redacted text (02 G6 Step 7), null
 * until the worker has read the case; `override_options` is null with no open
 * proposal or while core-mock is down.
 */
export const CaseDetailSchema = z.strictObject({
  case: z.strictObject({
    ...caseSummary,
    text: z.string().nullable(),
    manual_reruns: z.number().int(),
  }),
  runs: z.array(RunViewSchema),
  resolution: ResolutionViewSchema.nullable(),
  proposal: ProposalViewSchema.nullable(),
  override_options: OverrideOptionsSchema.nullable(),
});
export type CaseDetail = z.infer<typeof CaseDetailSchema>;
