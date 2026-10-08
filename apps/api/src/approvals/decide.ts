import {
  AWAITING_DECISION,
  CoreUnavailableError,
  DECISION_FAILURE,
  OPEN_PROPOSAL,
  hasPii,
  maskJson,
  readTransactions,
  type ActionParams,
  type ActionStatus,
  type ActionType,
  type CaseFlag,
  type CoreReader,
  type Decision,
  type DecisionFailure,
  type Override,
  type ReplyCheckCode,
  type Transaction,
  type DecisionAnswer,
} from '@fintech-agent/contracts';
import { and, eq } from 'drizzle-orm';

import { shapeViolation } from '../actions/allowed.js';
import { resolveTarget } from '../cases/case-transition.js';
import type { RequestMeta } from '../common/http/request-meta.js';
import type { Database } from '../database/index.js';
import {
  auditLog,
  cases,
  proposedActions,
  resolutions,
} from '../database/schema.js';
import type { Operator } from '../operators/operator-tokens.js';
import { replyViolations } from '../replies/reply-checks.js';
import { editRatio } from './edit-ratio.js';
import { transition } from './transition.js';

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

export type DecisionResult = DecisionAnswer;

export interface DecideDeps {
  db: Database;
  core: CoreReader;
  now: () => Date;
}

const APPROVE = 'approve';
const REJECT = 'reject';
const CORRECTED = 'wrong_action';

type Approval = Extract<Decision, { decision: typeof APPROVE }>;
type Rejection = Extract<Decision, { decision: typeof REJECT }>;

interface Target {
  type: ActionType;
  params: ActionParams;
}

interface Proposal {
  status: ActionStatus;
  isCanary: boolean;
  agent: Target;
  caseId: string;
  caseStatus: (typeof cases.$inferSelect)['status'];
  customerId: string;
  flags: CaseFlag[];
  reviewTier: (typeof cases.$inferSelect)['reviewTier'];
  draftReply: string | null;
}

interface Changes {
  status: ActionStatus;
  target: Target;
  columns: Partial<typeof proposedActions.$inferInsert>;
  audit: Record<string, unknown>;
}

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

async function readOrRefuse(
  reader: CoreReader,
  ids: readonly string[],
): Promise<(Transaction | null)[]> {
  try {
    return await readTransactions(reader, ids);
  } catch (error) {
    if (error instanceof CoreUnavailableError) {
      throw new DecisionError(DECISION_FAILURE.coreUnavailable);
    }
    throw error;
  }
}

async function overrideTarget(
  reader: CoreReader,
  customerId: string,
  override: Override,
): Promise<Target> {
  const found = await readOrRefuse(reader, override.transaction_ids);
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

async function approvalChanges(
  reader: CoreReader,
  proposal: Proposal,
  decision: Approval,
): Promise<Changes> {
  if (!sameSet(decision.acknowledged_flags, proposal.flags)) {
    throw new DecisionError(DECISION_FAILURE.flagsNotAcknowledged);
  }
  const target = decision.override
    ? await overrideTarget(reader, proposal.customerId, decision.override)
    : proposal.agent;
  const actionIds = target.params.transaction_ids;
  const reviewed = decision.reviewed_transaction_ids;
  // A case Persist left untiered is checked off like a high one: fail closed.
  const mustCheckOff =
    decision.override !== undefined ||
    (proposal.reviewTier !== 'standard' && actionIds.length > 0);
  const reviewedOk = mustCheckOff
    ? sameSet(reviewed, actionIds)
    : reviewed.every((id) => actionIds.includes(id));
  if (!reviewedOk) {
    throw new DecisionError(DECISION_FAILURE.transactionsNotReviewed);
  }
  // An approve of a canary is a miss, but an override replaces the defective
  // action instead of passing it, so the operator caught it.
  const caught =
    proposal.isCanary &&
    (target.type !== proposal.agent.type ||
      target.params.reason_code !== proposal.agent.params.reason_code ||
      !sameSet(
        target.params.transaction_ids,
        proposal.agent.params.transaction_ids,
      ));
  const status = transition(
    proposal.status,
    caught ? REJECT : APPROVE,
    proposal.isCanary,
  );
  if (!status) throw new DecisionError(DECISION_FAILURE.conflict);
  return {
    status,
    target,
    columns: {
      reviewedTransactionIds:
        reviewed.length > 0 ? [...new Set(reviewed)] : null,
      ...(caught ? { rejectCode: CORRECTED } : {}),
    },
    audit: { override: decision.override ?? null },
  };
}

function rejectionChanges(proposal: Proposal, decision: Rejection): Changes {
  // The reason is never sent to the customer, but it is persisted (G6).
  if (decision.reject_reason && hasPii(decision.reject_reason)) {
    throw new DecisionError(DECISION_FAILURE.piiInRejectReason);
  }
  const status = transition(proposal.status, REJECT, proposal.isCanary);
  if (!status) throw new DecisionError(DECISION_FAILURE.conflict);
  return {
    status,
    target: proposal.agent,
    columns: {
      rejectCode: decision.reject_code,
      rejectReason: decision.reject_reason ?? null,
    },
    audit: { reject_code: decision.reject_code },
  };
}

async function loadProposal(db: Database, actionId: string): Promise<Proposal> {
  const [row] = await db
    .select({
      status: proposedActions.status,
      isCanary: proposedActions.isCanary,
      agentType: proposedActions.agentType,
      agentParams: proposedActions.agentParams,
      caseId: cases.id,
      caseStatus: cases.status,
      customerId: cases.customerId,
      flags: cases.flags,
      reviewTier: cases.reviewTier,
      draftReply: resolutions.draftReply,
    })
    .from(proposedActions)
    .innerJoin(cases, eq(cases.id, proposedActions.caseId))
    .leftJoin(resolutions, eq(resolutions.runId, proposedActions.runId))
    .where(eq(proposedActions.id, actionId));
  if (!row) throw new DecisionError(DECISION_FAILURE.notFound);
  const { agentType, agentParams, ...rest } = row;
  return { ...rest, agent: { type: agentType, params: agentParams } };
}

/**
 * Applies an operator's decision to a proposal (02 G3). Every check that can
 * fail runs before the transaction; inside it, conditional updates on the
 * case and then the proposal turn a concurrent decision or re-run into a
 * conflict, and the G1 trigger refuses anything this code gets wrong.
 */
export async function decide(
  deps: DecideDeps,
  input: DecideInput,
): Promise<DecisionResult> {
  const { decision, operator } = input;
  const proposal = await loadProposal(deps.db, input.actionId);
  const resolvedCase = resolveTarget(proposal.caseStatus);
  if (!resolvedCase) throw new DecisionError(DECISION_FAILURE.conflict);
  const codes = replyViolations(decision.final_reply);
  if (codes.length > 0) {
    throw new DecisionError(DECISION_FAILURE.invalidReply, codes);
  }
  const changes =
    decision.decision === APPROVE
      ? await approvalChanges(deps.core, proposal, decision)
      : rejectionChanges(proposal, decision);
  const decidedAt = deps.now();
  const acknowledged: CaseFlag[] = [...new Set(decision.acknowledged_flags)];

  return deps.db.transaction(async (tx) => {
    // The case row is locked first, as a re-run locks it, so the two never deadlock.
    const resolved = await tx
      .update(cases)
      .set({ status: resolvedCase })
      .where(
        and(eq(cases.id, proposal.caseId), eq(cases.status, AWAITING_DECISION)),
      )
      .returning({ id: cases.id });
    if (resolved.length === 0) {
      throw new DecisionError(DECISION_FAILURE.conflict);
    }
    const updated = await tx
      .update(proposedActions)
      .set({
        ...changes.columns,
        status: changes.status,
        decidedBy: operator.actor,
        decidedAt,
        finalReply: decision.final_reply,
        replyEditRatio: editRatio(
          proposal.draftReply ?? '',
          decision.final_reply,
        ),
        acknowledgedFlags: acknowledged,
        type: changes.target.type,
        params: changes.target.params,
        operatorOverride: !sameAction(changes.target, proposal.agent),
      })
      .where(
        and(
          eq(proposedActions.id, input.actionId),
          eq(proposedActions.status, OPEN_PROPOSAL),
        ),
      )
      .returning({ id: proposedActions.id });
    if (updated.length === 0) {
      throw new DecisionError(DECISION_FAILURE.conflict);
    }
    await tx.insert(auditLog).values({
      at: decidedAt,
      actor: operator.actor,
      event: `decision.${decision.decision}`,
      ref: input.actionId,
      detailMasked: maskJson({
        status: changes.status,
        acknowledged_flags: acknowledged,
        ...changes.audit,
      }),
      keyId: operator.keyId,
      ip: input.meta.ip,
      userAgent: input.meta.userAgent,
    });
    return { action_id: input.actionId, status: changes.status };
  });
}
