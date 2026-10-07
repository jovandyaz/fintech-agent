import {
  CoreUnavailableError,
  maskJson,
  maskPii,
  type ActionParams,
  type ActionStatus,
  type ActionType,
  type CaseFlag,
  type CoreClient,
  type Decision,
  type Override,
  type ReplyCheckCode,
  type Transaction,
} from '@fintech-agent/contracts';
import { and, eq } from 'drizzle-orm';

import { shapeViolation } from '../actions/allowed.js';
import type { RequestMeta } from '../common/http/request-meta.js';
import type { Database } from '../database/index.js';
import {
  auditLog,
  cases,
  proposedActions,
  resolutions,
} from '../database/schema.js';
import { replyViolations } from '../replies/reply-checks.js';
import { editRatio } from './edit-ratio.js';
import type { Operator } from '../operators/operator-tokens.js';
import { transition } from './transition.js';

/** Why a decision was refused; the controller maps each to a status code. */
export const DECISION_FAILURE = {
  notFound: 'not_found',
  conflict: 'conflict',
  invalidReply: 'invalid_reply',
  piiInRejectReason: 'pii_in_reject_reason',
  flagsNotAcknowledged: 'flags_not_acknowledged',
  overrideNotAllowed: 'override_not_allowed',
  transactionsNotReviewed: 'transactions_not_reviewed',
  coreUnavailable: 'core_unavailable',
} as const;
export type DecisionFailure =
  (typeof DECISION_FAILURE)[keyof typeof DECISION_FAILURE];

/** A refused decision, with the reply check codes when the reply failed them. */
export class DecisionError extends Error {
  constructor(
    readonly failure: DecisionFailure,
    readonly codes: readonly ReplyCheckCode[] = [],
  ) {
    super(failure);
  }
}

export interface DecideInput {
  actionId: string;
  decision: Decision;
  operator: Operator;
  meta: RequestMeta;
}

export interface DecisionResult {
  action_id: string;
  status: ActionStatus;
}

export interface DecideDeps {
  db: Database;
  core: CoreClient;
  now: () => Date;
}

interface Target {
  type: ActionType;
  params: ActionParams;
}

const OPEN: ActionStatus = 'proposed';
const APPROVE = 'approve';

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((item) => right.has(item));
};

// Mirrors the trigger's `(type, params) IS DISTINCT FROM (agent_type,
// agent_params)`: jsonb arrays compare in order, so a reordered list differs.
const sameAction = (a: Target, b: Target): boolean =>
  a.type === b.type &&
  a.params.reason_code === b.params.reason_code &&
  a.params.transaction_ids.length === b.params.transaction_ids.length &&
  a.params.transaction_ids.every((id, i) => id === b.params.transaction_ids[i]);

async function readTransactions(
  core: CoreClient,
  ids: readonly string[],
): Promise<(Transaction | null)[]> {
  try {
    return await Promise.all(ids.map((id) => core.transaction(id)));
  } catch (error) {
    if (error instanceof CoreUnavailableError) {
      throw new DecisionError(DECISION_FAILURE.coreUnavailable);
    }
    throw error;
  }
}

async function overrideTarget(
  core: CoreClient,
  customerId: string,
  override: Override,
): Promise<Target> {
  const found = await readTransactions(core, override.transaction_ids);
  const owned = found.filter(
    (transaction): transaction is Transaction =>
      transaction?.customer_id === customerId,
  );
  // A foreign id and a missing one fail alike, so the answer is no ownership oracle.
  if (
    owned.length !== override.transaction_ids.length ||
    shapeViolation(override.type, owned) !== null
  ) {
    throw new DecisionError(DECISION_FAILURE.overrideNotAllowed);
  }
  return {
    type: override.type,
    params: {
      transaction_ids: override.transaction_ids,
      reason_code: override.reason_code,
    },
  };
}

/**
 * Applies an operator's decision to a proposal (02 G3). Every check that can
 * fail runs before the transaction; inside it, conditional updates on the
 * proposal and the case turn a concurrent decision into a conflict, and the
 * G1 trigger refuses anything this code gets wrong.
 */
export async function decide(
  deps: DecideDeps,
  input: DecideInput,
): Promise<DecisionResult> {
  const { decision, operator } = input;
  const [row] = await deps.db
    .select({
      status: proposedActions.status,
      isCanary: proposedActions.isCanary,
      agentType: proposedActions.agentType,
      agentParams: proposedActions.agentParams,
      caseId: cases.id,
      customerId: cases.customerId,
      flags: cases.flags,
      reviewTier: cases.reviewTier,
      draftReply: resolutions.draftReply,
    })
    .from(proposedActions)
    .innerJoin(cases, eq(cases.id, proposedActions.caseId))
    .leftJoin(resolutions, eq(resolutions.runId, proposedActions.runId))
    .where(eq(proposedActions.id, input.actionId));
  if (!row) throw new DecisionError(DECISION_FAILURE.notFound);
  if (row.status !== OPEN) throw new DecisionError(DECISION_FAILURE.conflict);

  const codes = replyViolations(decision.final_reply);
  if (codes.length > 0) {
    throw new DecisionError(DECISION_FAILURE.invalidReply, codes);
  }

  const agent: Target = { type: row.agentType, params: row.agentParams };
  let target = agent;
  let decided: Partial<typeof proposedActions.$inferInsert>;
  if (decision.decision === APPROVE) {
    if (!sameSet(decision.acknowledged_flags, row.flags)) {
      throw new DecisionError(DECISION_FAILURE.flagsNotAcknowledged);
    }
    if (decision.override) {
      target = await overrideTarget(
        deps.core,
        row.customerId,
        decision.override,
      );
    }
    const mustCheckOff =
      decision.override !== undefined ||
      (row.reviewTier === 'high' && target.params.transaction_ids.length > 0);
    if (
      mustCheckOff &&
      !sameSet(decision.reviewed_transaction_ids, target.params.transaction_ids)
    ) {
      throw new DecisionError(DECISION_FAILURE.transactionsNotReviewed);
    }
    decided = {
      reviewedTransactionIds: [...new Set(decision.reviewed_transaction_ids)],
    };
  } else {
    // The reason is never sent to the customer, but it is persisted (G6).
    if (
      decision.reject_reason &&
      maskPii(decision.reject_reason) !== decision.reject_reason
    ) {
      throw new DecisionError(DECISION_FAILURE.piiInRejectReason);
    }
    decided = {
      rejectCode: decision.reject_code,
      rejectReason: decision.reject_reason ?? null,
    };
  }

  const status = transition(OPEN, decision.decision, row.isCanary);
  if (!status) throw new DecisionError(DECISION_FAILURE.conflict);
  const decidedAt = deps.now();
  const acknowledged: CaseFlag[] = [...new Set(decision.acknowledged_flags)];

  return deps.db.transaction(async (tx) => {
    const updated = await tx
      .update(proposedActions)
      .set({
        ...decided,
        status,
        decidedBy: operator.actor,
        decidedAt,
        finalReply: decision.final_reply,
        replyEditRatio: editRatio(row.draftReply ?? '', decision.final_reply),
        acknowledgedFlags: acknowledged,
        type: target.type,
        params: target.params,
        operatorOverride: !sameAction(target, agent),
      })
      .where(
        and(
          eq(proposedActions.id, input.actionId),
          eq(proposedActions.status, OPEN),
        ),
      )
      .returning({ id: proposedActions.id });
    if (updated.length === 0)
      throw new DecisionError(DECISION_FAILURE.conflict);

    const resolved = await tx
      .update(cases)
      .set({ status: 'resolved' })
      .where(and(eq(cases.id, row.caseId), eq(cases.status, 'needs_review')))
      .returning({ id: cases.id });
    if (resolved.length === 0)
      throw new DecisionError(DECISION_FAILURE.conflict);

    await tx.insert(auditLog).values({
      at: decidedAt,
      actor: operator.actor,
      event: `decision.${decision.decision}`,
      ref: input.actionId,
      detailMasked: maskJson({
        status,
        acknowledged_flags: acknowledged,
        override:
          decision.decision === APPROVE ? (decision.override ?? null) : null,
        reject_code:
          decision.decision === APPROVE ? null : decision.reject_code,
      }),
      keyId: operator.keyId,
      ip: input.meta.ip,
      userAgent: input.meta.userAgent,
    });
    return { action_id: input.actionId, status };
  });
}
