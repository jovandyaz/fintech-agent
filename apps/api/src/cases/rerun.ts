import type { ActionStatus, CaseStatus } from '@fintech-agent/contracts';
import { and, eq, sql } from 'drizzle-orm';

import type { RequestMeta } from '../common/http/request-meta.js';
import type { Database } from '../database/index.js';
import { auditLog, cases, proposedActions } from '../database/schema.js';
import type { Operator } from '../operators/operator-tokens.js';
import { rerunTarget } from './case-transition.js';

/** Why a re-run was refused; the controller maps each to a status code. */
export const RERUN_FAILURE = {
  notFound: 'not_found',
  conflict: 'conflict',
} as const;
export type RerunFailure = (typeof RERUN_FAILURE)[keyof typeof RERUN_FAILURE];

export class RerunError extends Error {
  constructor(readonly failure: RerunFailure) {
    super(failure);
  }
}

export interface RerunResult {
  case_id: string;
  status: CaseStatus;
  manual_reruns: number;
}

const OPEN: ActionStatus = 'proposed';

/**
 * An operator's manual re-run (02 G3): the case goes back to `queued` and its
 * open proposal becomes `superseded`; decided proposals are never touched.
 * The update is conditional on the status it read, so a concurrent
 * re-run or decision turns this one into a conflict.
 */
export async function rerunCase(
  deps: { db: Database; now: () => Date },
  input: { caseId: string; operator: Operator; meta: RequestMeta },
): Promise<RerunResult> {
  const [row] = await deps.db
    .select({ status: cases.status, manualReruns: cases.manualReruns })
    .from(cases)
    .where(eq(cases.id, input.caseId));
  if (!row) throw new RerunError(RERUN_FAILURE.notFound);
  const status = rerunTarget(row.status, row.manualReruns);
  if (!status) throw new RerunError(RERUN_FAILURE.conflict);
  const now = deps.now();

  return deps.db.transaction(async (tx) => {
    const [updated] = await tx
      .update(cases)
      .set({
        status,
        manualReruns: sql`${cases.manualReruns} + 1`,
        attempts: 0,
        nextAttemptAt: now,
        lockedUntil: null,
        claimToken: null,
      })
      .where(and(eq(cases.id, input.caseId), eq(cases.status, row.status)))
      .returning({ manualReruns: cases.manualReruns });
    if (!updated) throw new RerunError(RERUN_FAILURE.conflict);

    await tx
      .update(proposedActions)
      .set({ status: 'superseded' })
      .where(
        and(
          eq(proposedActions.caseId, input.caseId),
          eq(proposedActions.status, OPEN),
        ),
      );
    await tx.insert(auditLog).values({
      at: now,
      actor: input.operator.actor,
      event: 'case.rerun',
      ref: input.caseId,
      detailMasked: { from: row.status, manual_reruns: updated.manualReruns },
      keyId: input.operator.keyId,
      ip: input.meta.ip,
      userAgent: input.meta.userAgent,
    });
    return {
      case_id: input.caseId,
      status,
      manual_reruns: updated.manualReruns,
    };
  });
}
