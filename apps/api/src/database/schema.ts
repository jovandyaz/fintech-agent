import {
  ACTION_STATUSES,
  ACTION_TYPES,
  CASE_CATEGORIES,
  CASE_SOURCES,
  CASE_STATUSES,
  EXECUTION_STATUSES,
  REJECT_CODES,
  REVIEW_TIERS,
  RUN_STATUSES,
  SECURITY_EVENT_KINDS,
  STEP_KINDS,
  STOP_REASONS,
} from '@fintech-agent/contracts';
import { sql, type SQL } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type PgColumn,
} from 'drizzle-orm/pg-core';

const SEARCH_CONFIG = sql.raw(`'es_unaccent'`);
const USD_PRECISION = 12;
const USD_SCALE = 6;

const tsvector = customType<{ data: string }>({
  dataType: () => 'tsvector',
});

const at = (name: string) => timestamp(name, { withTimezone: true });
const usd = (name: string) =>
  numeric(name, { precision: USD_PRECISION, scale: USD_SCALE });
const caseIdRef = () =>
  text('case_id')
    .notNull()
    .references(() => cases.id);
const runIdRef = () => text('run_id').references(() => agentRuns.id);
const weighted = (column: PgColumn, weight: 'A' | 'B' | 'D'): SQL =>
  sql`setweight(to_tsvector(${SEARCH_CONFIG}, ${column}), ${sql.raw(`'${weight}'`)})`;

export const caseStatus = pgEnum('case_status', CASE_STATUSES);
export const caseSource = pgEnum('case_source', CASE_SOURCES);
export const caseCategory = pgEnum('case_category', CASE_CATEGORIES);
export const reviewTier = pgEnum('review_tier', REVIEW_TIERS);
export const runStatus = pgEnum('run_status', RUN_STATUSES);
export const stopReason = pgEnum('stop_reason', STOP_REASONS);
export const stepKind = pgEnum('step_kind', STEP_KINDS);
export const actionType = pgEnum('action_type', ACTION_TYPES);
export const actionStatus = pgEnum('action_status', ACTION_STATUSES);
export const executionStatus = pgEnum('execution_status', EXECUTION_STATUSES);
export const rejectCode = pgEnum('reject_code', REJECT_CODES);
export const securityEventKind = pgEnum(
  'security_event_kind',
  SECURITY_EVENT_KINDS,
);

export const cases = pgTable(
  'cases',
  {
    id: text().primaryKey(),
    ticketId: text('ticket_id').notNull().unique(),
    folio: text().notNull().unique(),
    receivedAt: at('received_at').notNull(),
    source: caseSource().notNull(),
    customerId: text('customer_id').notNull(),
    textMasked: text('text_masked').notNull(),
    textRedacted: text('text_redacted'),
    status: caseStatus().notNull().default('queued'),
    attempts: integer().notNull().default(0),
    manualReruns: integer('manual_reruns').notNull().default(0),
    lockedUntil: at('locked_until'),
    claimToken: uuid('claim_token'),
    nextAttemptAt: at('next_attempt_at').notNull().defaultNow(),
    category: caseCategory(),
    flags: jsonb().notNull().default([]),
    reviewTier: reviewTier('review_tier'),
  },
  (t) => [index('cases_claimable').on(t.status, t.nextAttemptAt)],
);

export const webhookEvents = pgTable('webhook_events', {
  eventId: text('event_id').primaryKey(),
  payloadHash: text('payload_hash').notNull(),
  caseId: caseIdRef(),
  receivedAt: at('received_at').notNull().defaultNow(),
});

export const agentRuns = pgTable('agent_runs', {
  id: text().primaryKey(),
  caseId: caseIdRef(),
  variant: text().notNull(),
  model: text().notNull(),
  promptVersion: text('prompt_version').notNull(),
  status: runStatus().notNull().default('running'),
  stopReason: stopReason('stop_reason'),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
  costUsd: usd('cost_usd').notNull().default('0'),
  latencyMs: integer('latency_ms'),
  errorCode: text('error_code'),
  startedAt: at('started_at').notNull().defaultNow(),
  finishedAt: at('finished_at'),
});

export const runSteps = pgTable(
  'run_steps',
  {
    runId: runIdRef().notNull(),
    idx: integer().notNull(),
    kind: stepKind().notNull(),
    name: text().notNull(),
    inputMasked: jsonb('input_masked'),
    outputMasked: jsonb('output_masked'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cachedInputTokens: integer('cached_input_tokens'),
    costUsd: usd('cost_usd'),
    latencyMs: integer('latency_ms'),
    providerRequestId: text('provider_request_id'),
    finishReason: text('finish_reason'),
  },
  (t) => [primaryKey({ columns: [t.runId, t.idx] })],
);

export const resolutions = pgTable('resolutions', {
  runId: runIdRef().primaryKey(),
  category: caseCategory().notNull(),
  draftReply: text('draft_reply').notNull(),
  citations: jsonb().notNull(),
  abstained: boolean().notNull(),
  reasoningSummary: text('reasoning_summary').notNull(),
});

export const proposedActions = pgTable(
  'proposed_actions',
  {
    id: text().primaryKey(),
    caseId: caseIdRef(),
    runId: runIdRef(),
    agentType: actionType('agent_type').notNull(),
    agentParams: jsonb('agent_params').notNull(),
    type: actionType().notNull(),
    params: jsonb().notNull(),
    justification: text().notNull(),
    status: actionStatus().notNull().default('proposed'),
    proposedAt: at('proposed_at').notNull().defaultNow(),
    decidedBy: text('decided_by'),
    decidedAt: at('decided_at'),
    finalReply: text('final_reply'),
    rejectCode: rejectCode('reject_code'),
    rejectReason: text('reject_reason'),
    replyEditRatio: real('reply_edit_ratio'),
    acknowledgedFlags: jsonb('acknowledged_flags'),
    reviewedTransactionIds: jsonb('reviewed_transaction_ids'),
    operatorOverride: boolean('operator_override').notNull().default(false),
    isCanary: boolean('is_canary').notNull().default(false),
  },
  (t) => [
    uniqueIndex('one_open_proposal_per_case')
      .on(t.caseId)
      .where(sql`${t.status} = 'proposed'`),
  ],
);

export const actionExecutions = pgTable('action_executions', {
  actionId: text('action_id')
    .primaryKey()
    .references(() => proposedActions.id),
  status: executionStatus().notNull(),
  attempts: integer().notNull().default(1),
  startedAt: at('started_at').notNull().defaultNow(),
  finishedAt: at('finished_at'),
  result: jsonb(),
});

export const auditLog = pgTable('audit_log', {
  id: uuid().primaryKey().defaultRandom(),
  at: at('at').notNull().defaultNow(),
  actor: text().notNull(),
  event: text().notNull(),
  ref: text().notNull(),
  detailMasked: jsonb('detail_masked').notNull().default({}),
  keyId: text('key_id'),
  ip: text(),
  userAgent: text('user_agent'),
});

export const securityEvents = pgTable('security_events', {
  id: uuid().primaryKey().defaultRandom(),
  at: at('at').notNull().defaultNow(),
  kind: securityEventKind().notNull(),
  caseId: caseIdRef(),
  runId: runIdRef().notNull(),
  refMasked: text('ref_masked').notNull(),
});

export const policyChunks = pgTable(
  'policy_chunks',
  {
    id: text().primaryKey(),
    docId: text('doc_id').notNull(),
    section: text().notNull(),
    content: text().notNull(),
    keywords: text().notNull().default(''),
    tsv: tsvector()
      .notNull()
      .generatedAlwaysAs(
        (): SQL =>
          sql`${weighted(policyChunks.section, 'A')} || ${weighted(policyChunks.keywords, 'B')} || ${weighted(policyChunks.content, 'D')}`,
      ),
    stateRules: jsonb('state_rules').notNull().default([]),
    contentHash: text('content_hash').notNull(),
    quarantined: boolean().notNull().default(false),
  },
  (t) => [index('policy_chunks_tsv').using('gin', t.tsv)],
);
