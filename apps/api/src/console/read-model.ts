import {
  CitationSchema,
  CoreUnavailableError,
  MAX_LIST_LIMIT,
  OPEN_PROPOSAL,
  TransactionRowSchema,
  maskJson,
  transactionRowOf,
  type CaseDetail,
  type CaseStatus,
  type CoreClient,
  type InboxItem,
  type OverrideOptions,
  type RunView,
  type Transaction,
} from '@fintech-agent/contracts';
import { asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';

import { overrideOptionsOf } from '../actions/allowed.js';
import type { Database } from '../database/index.js';
import {
  agentRuns,
  cases,
  proposedActions,
  resolutions,
  runSteps,
} from '../database/schema.js';

/** What the console's reads need: the database and the core-mock read client. */
export interface ReadModelDeps {
  db: Database;
  core: Pick<CoreClient, 'transaction' | 'transactions'>;
}

// The console polls the inbox every few seconds, so it is bounded; a case past
// the bound is still opened by id.
const INBOX_LIMIT = 200;
const RESOLVED: CaseStatus = 'resolved';

type CaseRow = typeof cases.$inferSelect;

const summaryOf = (row: CaseRow): InboxItem => ({
  case_id: row.id,
  folio: row.folio,
  status: row.status,
  review_tier: row.reviewTier,
  flags: row.flags,
  category: row.category,
  received_at: row.receivedAt.toISOString(),
});

/** The inbox (01): open work before decided cases, the `high` review tier first, then newest; eval cases only when asked. */
export async function inboxOf(
  db: Database,
  input: { includeEval: boolean },
): Promise<InboxItem[]> {
  const rows = await db
    .select()
    .from(cases)
    .where(input.includeEval ? undefined : ne(cases.source, 'eval'))
    .orderBy(
      asc(eq(cases.status, RESOLVED)),
      desc(sql`coalesce(${eq(cases.reviewTier, 'high')}, false)`),
      desc(cases.receivedAt),
      asc(cases.id),
    )
    .limit(INBOX_LIMIT);
  return rows.map(summaryOf);
}

/**
 * One case as the console shows it, or null when there is none: its runs with
 * their masked traces, the resolution behind its latest proposal, that
 * proposal, and, while it is open, what an override may pick from.
 */
export async function caseDetailOf(
  deps: ReadModelDeps,
  caseId: string,
): Promise<CaseDetail | null> {
  const { db } = deps;
  const [row] = await db.select().from(cases).where(eq(cases.id, caseId));
  if (!row) return null;
  const runs = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.caseId, caseId))
    .orderBy(asc(agentRuns.startedAt), asc(agentRuns.id));
  const steps =
    runs.length === 0
      ? []
      : await db
          .select()
          .from(runSteps)
          .where(
            inArray(
              runSteps.runId,
              runs.map(({ id }) => id),
            ),
          )
          .orderBy(asc(runSteps.idx));
  const [proposal] = await db
    .select()
    .from(proposedActions)
    .where(eq(proposedActions.caseId, caseId))
    .orderBy(desc(proposedActions.proposedAt), desc(proposedActions.id))
    .limit(1);
  const resolutionRunId = proposal?.runId ?? runs.at(-1)?.id;
  const [resolution] = resolutionRunId
    ? await db
        .select()
        .from(resolutions)
        .where(eq(resolutions.runId, resolutionRunId))
    : [];

  return {
    case: {
      ...summaryOf(row),
      text: row.textRedacted,
      manual_reruns: row.manualReruns,
    },
    runs: runs.map((run): RunView => ({
      run_id: run.id,
      status: run.status,
      stop_reason: run.stopReason,
      error_code: run.errorCode,
      model: run.model,
      input_tokens: run.inputTokens,
      output_tokens: run.outputTokens,
      cost_usd: run.costUsd,
      latency_ms: run.latencyMs,
      steps: steps
        .filter((step) => step.runId === run.id)
        .map((step) => ({
          idx: step.idx,
          kind: step.kind,
          name: step.name,
          input: maskJson(step.inputMasked),
          output: maskJson(step.outputMasked),
          latency_ms: step.latencyMs,
          cost_usd: step.costUsd,
        })),
    })),
    resolution: resolution
      ? {
          category: resolution.category,
          draft_reply: resolution.draftReply,
          citations: CitationSchema.array().parse(resolution.citations),
          abstained: resolution.abstained,
          reasoning_summary: resolution.reasoningSummary,
        }
      : null,
    proposal: proposal
      ? {
          action_id: proposal.id,
          type: proposal.type,
          params: proposal.params,
          justification: proposal.justification,
          status: proposal.status,
        }
      : null,
    override_options:
      proposal?.status === OPEN_PROPOSAL
        ? await overrideOptionsFor(
            deps.core,
            row.customerId,
            proposal.params.transaction_ids,
          )
        : null,
  };
}

// The proposal may name a transaction older than the newest page, so it is
// read by id and kept only when it is this customer's, as decide checks.
// Core-mock down takes only the picker away; the proposal can still be decided.
async function overrideOptionsFor(
  core: ReadModelDeps['core'],
  customerId: string,
  proposed: readonly string[],
): Promise<OverrideOptions | null> {
  let items: Transaction[];
  try {
    const page = await core.transactions(
      customerId,
      new URLSearchParams({ limit: String(MAX_LIST_LIMIT) }),
    );
    if (!page) return null;
    const listed = new Set(page.items.map(({ id }) => id));
    const older = await Promise.all(
      proposed
        .filter((id) => !listed.has(id))
        .map((id) => core.transaction(id)),
    );
    items = [
      ...page.items,
      ...older.filter(
        (tx): tx is Transaction => tx?.customer_id === customerId,
      ),
    ];
  } catch (error) {
    if (error instanceof CoreUnavailableError) return null;
    throw error;
  }
  return {
    actions: overrideOptionsOf(items),
    transactions: items.map((tx) =>
      TransactionRowSchema.parse(maskJson(transactionRowOf(tx))),
    ),
  };
}
