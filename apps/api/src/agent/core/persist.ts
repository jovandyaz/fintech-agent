import {
  CASE_FLAGS,
  maskPii,
  newRegistryId,
  type ActionStatus,
  type ActionType,
  type CaseCategory,
  type CaseStatus,
  type CaseFlag,
  type ProposedAction,
  type Resolution,
  type ReviewTier,
  type RunStatus,
  type StopReason,
} from '@fintech-agent/contracts';

import { and, count, eq, gte, inArray, not } from 'drizzle-orm';

import { proposalAudit } from '../../cases/proposal-audit.js';
import { reviewTierOf } from '../../cases/review-tier.js';
import type { Database, DbTransaction } from '../../database/index.js';
import {
  agentRuns,
  auditLog,
  cases,
  proposedActions,
  resolutions,
  runSteps,
} from '../../database/schema.js';
import { replyViolations } from '../../replies/reply-checks.js';
import { traceTotals, type AgentOutcome, type StepRecord } from './agent.js';
import { StaleClaimError, withClaim, type Claim } from './queue.js';
import type { RunEvidence } from './validate/evidence.js';
import { factFlags } from './validate/flags.js';
import { noneAction } from './validate/index.js';
import { fillPlaceholders } from './validate/placeholders.js';
import {
  policyConflicts,
  type ChunkStateRules,
} from './validate/state-rules.js';

const SUCCEEDED = 'succeeded' satisfies RunStatus;
const FALLBACK = 'fallback' satisfies RunStatus;
const STOP = {
  completed: 'completed',
  validation: 'validation',
  agentDisabled: 'agent_disabled',
  error: 'error',
} as const satisfies Record<string, StopReason>;
const FILL_FAILED = 'placeholder_fill_failed';

/** The kill switch's outcome: no model call was made (01 §Failure handling). */
export const AGENT_DISABLED = { kind: 'disabled' } as const;
export type PersistOutcome = AgentOutcome | typeof AGENT_DISABLED;

/** What Persist knows besides the outcome; read inside the fenced transaction. */
export interface SettleContext {
  folio: string;
  receivedAt: Date;
  /** The customer's approved or executed disputes in the lookback (02 G3). */
  priorOpenDisputes: number;
  /** The run's corpus rules, to find the conflicts a stopped run saw. */
  stateRules: readonly ChunkStateRules[];
  log: (event: Record<string, unknown>) => void;
}

/** The rows one attempt ends with, decided before anything is written. */
export interface Settlement {
  runStatus: typeof SUCCEEDED | typeof FALLBACK;
  stopReason: StopReason;
  /** The accepted resolution with its draft filled; null on a fallback. */
  resolution: Resolution | null;
  category: CaseCategory | null;
  action: ProposedAction;
  flags: CaseFlag[];
  reviewTier: ReviewTier;
}

interface Fallback {
  stopReason: StopReason;
  action: ProposedAction;
  evidence: RunEvidence | null;
  hasConflicts: boolean;
}

const inFlagOrder = (flags: Iterable<CaseFlag>): CaseFlag[] => {
  const found = new Set(flags);
  return CASE_FLAGS.filter((flag) => found.has(flag));
};

function fallbackSettlement(
  fallback: Fallback,
  context: SettleContext,
): Settlement {
  const { action, evidence } = fallback;
  const flags: CaseFlag[] = [FALLBACK];
  if (evidence) {
    flags.push(
      ...factFlags({ category: null, proposed_action: action }, evidence, {
        priorOpenDisputes: context.priorOpenDisputes,
      }),
    );
    if (evidence.injectionSignal) flags.push('injection_signal');
  }
  if (fallback.hasConflicts) flags.push('policy_data_conflict');
  const ordered = inFlagOrder(flags);
  return {
    runStatus: FALLBACK,
    stopReason: fallback.stopReason,
    resolution: null,
    category: null,
    action,
    flags: ordered,
    reviewTier: reviewTierOf(action.type, ordered),
  };
}

// The draft is filled from data (the customer's name, the bank calendar), so
// the filled text is checked again: a name the core holds could carry a link.
function acceptedSettlement(
  validation: Extract<
    Extract<AgentOutcome, { kind: 'validated' }>['validation'],
    { kind: 'valid' }
  >,
  context: SettleContext,
): Settlement {
  const { resolution, evidence, conflicts } = validation;
  const hasConflicts = conflicts.length > 0;
  const fallback = (stopReason: StopReason, justification: string) =>
    fallbackSettlement(
      { stopReason, action: noneAction(justification), evidence, hasConflicts },
      context,
    );
  let draft: string;
  try {
    draft = fillPlaceholders(resolution.draft_reply, {
      receivedAt: context.receivedAt,
      folio: context.folio,
      firstName: evidence.customer?.first_name ?? null,
    });
  } catch (error) {
    context.log({ event: FILL_FAILED, error: maskPii(String(error)) });
    return fallback(STOP.error, FILL_FAILED);
  }
  const violations = replyViolations(draft);
  if (violations.length > 0) {
    return fallback(
      STOP.validation,
      `Filled reply failed: ${violations.join(', ')}`,
    );
  }
  const flags: CaseFlag[] = factFlags(resolution, evidence, {
    priorOpenDisputes: context.priorOpenDisputes,
  });
  if (hasConflicts) flags.push('policy_data_conflict');
  if (resolution.abstained) flags.push('abstained');
  if (evidence.injectionSignal) flags.push('injection_signal');
  const ordered = inFlagOrder(flags);
  return {
    runStatus: SUCCEEDED,
    stopReason: STOP.completed,
    resolution: { ...resolution, draft_reply: draft },
    category: resolution.category,
    action: resolution.proposed_action,
    flags: ordered,
    reviewTier: reviewTierOf(resolution.proposed_action.type, ordered),
  };
}

/**
 * Decides an attempt's end (01 §Agent pipeline, Persist): the accepted
 * resolution with its draft filled and re-checked, or the fallback `none`
 * with a visible reason; the case flags (02 G2, G3, G5) and the review tier.
 * Pure: `persistRun` writes what it returns.
 */
export function settle(
  outcome: PersistOutcome,
  context: SettleContext,
): Settlement {
  switch (outcome.kind) {
    case AGENT_DISABLED.kind:
      return fallbackSettlement(
        {
          stopReason: STOP.agentDisabled,
          action: noneAction('Agent disabled (AGENT_MODE=off)'),
          evidence: null,
          hasConflicts: false,
        },
        context,
      );
    case 'stopped':
      return fallbackSettlement(
        {
          stopReason: outcome.stopReason,
          action: noneAction(`Run stopped: ${outcome.reason}`),
          evidence: outcome.evidence,
          hasConflicts:
            policyConflicts(outcome.evidence, context.stateRules).length > 0,
        },
        context,
      );
    case 'validated': {
      const { validation } = outcome;
      if (validation.kind === 'valid') {
        return acceptedSettlement(validation, context);
      }
      return fallbackSettlement(
        {
          stopReason: STOP.validation,
          action: validation.action,
          evidence: validation.evidence,
          hasConflicts: validation.conflicts.length > 0,
        },
        context,
      );
    }
  }
}

const FIRST_PARTY_LOOKBACK_DAYS = 120;
const DAY_MS = 86_400_000;
const RUNNING = 'running' satisfies RunStatus;
const NEEDS_REVIEW = 'needs_review' satisfies CaseStatus;
const OPEN_DISPUTE = 'open_dispute' satisfies ActionType;
const DECIDED_DISPUTE: ActionStatus[] = ['approved', 'executed'];

/** One attempt's end as the harness hands it to Persist. */
export interface PersistInput {
  claim: Claim;
  runId: string;
  outcome: PersistOutcome;
  /** Every step of the attempt, intake guards first, in the order they ran. */
  trace: readonly StepRecord[];
  stateRules: readonly ChunkStateRules[];
  now: Date;
  log: (event: Record<string, unknown>) => void;
}

export interface Persisted {
  runStatus: Settlement['runStatus'];
  actionId: string;
}

async function priorOpenDisputes(
  tx: DbTransaction,
  customerId: string,
  now: Date,
): Promise<number> {
  const since = new Date(now.getTime() - FIRST_PARTY_LOOKBACK_DAYS * DAY_MS);
  const [row] = await tx
    .select({ n: count() })
    .from(proposedActions)
    .innerJoin(cases, eq(cases.id, proposedActions.caseId))
    .where(
      and(
        eq(cases.customerId, customerId),
        eq(proposedActions.type, OPEN_DISPUTE),
        inArray(proposedActions.status, DECIDED_DISPUTE),
        not(proposedActions.isCanary),
        gte(proposedActions.decidedAt, since),
      ),
    );
  return row?.n ?? 0;
}

const usdOf = (value: number | null): string | null =>
  value === null ? null : String(value);

/**
 * Persist (01 §Agent pipeline): in one transaction fenced by the claim, ends
 * the run with its totals, writes its steps, the resolution (only when one
 * was accepted), the proposal and its audit row, and moves the case to
 * `needs_review`, releasing the claim. A claim that is no longer current, or
 * a run that is no longer running, throws `StaleClaimError` and writes nothing.
 */
export async function persistRun(
  db: Database,
  input: PersistInput,
): Promise<Persisted> {
  const { claim, runId, now } = input;
  return withClaim(db, claim, async (tx) => {
    const [held] = await tx
      .select({
        folio: cases.folio,
        receivedAt: cases.receivedAt,
        customerId: cases.customerId,
      })
      .from(cases)
      .where(eq(cases.id, claim.caseId));
    const [run] = await tx
      .select({
        variant: agentRuns.variant,
        promptVersion: agentRuns.promptVersion,
        startedAt: agentRuns.startedAt,
      })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.id, runId),
          eq(agentRuns.caseId, claim.caseId),
          eq(agentRuns.status, RUNNING),
        ),
      );
    if (!held || !run) throw new StaleClaimError(claim.caseId);

    const settled = settle(input.outcome, {
      folio: held.folio,
      receivedAt: held.receivedAt,
      priorOpenDisputes: await priorOpenDisputes(tx, held.customerId, now),
      stateRules: input.stateRules,
      log: input.log,
    });
    const totals = traceTotals(input.trace);
    await tx
      .update(agentRuns)
      .set({
        status: settled.runStatus,
        stopReason: settled.stopReason,
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        cachedInputTokens: totals.cachedInputTokens,
        costUsd: String(totals.costUsd),
        latencyMs: now.getTime() - run.startedAt.getTime(),
        finishedAt: now,
      })
      .where(eq(agentRuns.id, runId));
    if (input.trace.length > 0) {
      await tx.insert(runSteps).values(
        input.trace.map((record, idx) => ({
          ...record,
          runId,
          idx,
          costUsd: usdOf(record.costUsd),
        })),
      );
    }
    if (settled.resolution) {
      const { resolution } = settled;
      await tx.insert(resolutions).values({
        runId,
        category: resolution.category,
        draftReply: resolution.draft_reply,
        citations: resolution.citations,
        abstained: resolution.abstained,
        reasoningSummary: resolution.reasoning_summary,
      });
    }
    const { action } = settled;
    const actionId = newRegistryId('act');
    const params = {
      transaction_ids: action.transaction_ids,
      reason_code: action.reason_code,
    };
    await tx.insert(proposedActions).values({
      id: actionId,
      caseId: claim.caseId,
      runId,
      agentType: action.type,
      agentParams: params,
      type: action.type,
      params,
      justification: action.justification,
      proposedAt: now,
    });
    await tx.insert(auditLog).values(
      proposalAudit({
        at: now,
        variant: run.variant,
        promptVersion: run.promptVersion,
        actionId,
        runId,
        type: action.type,
        flags: settled.flags,
        reviewTier: settled.reviewTier,
      }),
    );
    await tx
      .update(cases)
      .set({
        status: NEEDS_REVIEW,
        category: settled.category,
        flags: settled.flags,
        reviewTier: settled.reviewTier,
        claimToken: null,
        lockedUntil: null,
      })
      .where(eq(cases.id, claim.caseId));
    return { runStatus: settled.runStatus, actionId };
  });
}
