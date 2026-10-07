import { maskJson, type CaseStatus } from '@fintech-agent/contracts';
import { and, eq } from 'drizzle-orm';

import { OPEN_PROPOSAL, transition } from '../approvals/transition.js';
import { cloneCanary } from '../canaries/inject.js';
import { REFUSAL } from '../common/errors/refusal.js';
import type { RequestMeta } from '../common/http/request-meta.js';
import type { Database } from '../database/index.js';
import { auditLog, cases, proposedActions } from '../database/schema.js';
import type { Operator } from '../operators/operator-tokens.js';
import { rerunTarget } from './case-transition.js';

/** Why a re-run was refused; the controller maps each to a status code. */
export const RERUN_FAILURE = REFUSAL;
export type RerunFailure = (typeof RERUN_FAILURE)[keyof typeof RERUN_FAILURE];

/** A refused re-run. */
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

export interface RerunDeps {
  db: Database;
  now: () => Date;
}

/**
 * An operator's manual re-run (02 G3): the case goes back to `queued` and its
 * open proposal becomes `superseded`, through `transition()`, with an audit
 * row for each; decided proposals are never touched. The case row is locked
 * first, as a decision locks it. A case holding a canary answers the same but
 * stays out of the queue: its open canary is replaced by a fresh copy, and a
 * decided one cannot be re-run.
 */
export async function rerunCase(
  deps: RerunDeps,
  input: { caseId: string; operator: Operator; meta: RequestMeta },
): Promise<RerunResult> {
  return deps.db.transaction(async (tx) => {
    const [row] = await tx
      .select({ status: cases.status, manualReruns: cases.manualReruns })
      .from(cases)
      .where(eq(cases.id, input.caseId))
      .for('update');
    if (!row) throw new RerunError(RERUN_FAILURE.notFound);
    const target = rerunTarget(row.status, row.manualReruns);
    if (!target) throw new RerunError(RERUN_FAILURE.conflict);

    const proposals = await tx
      .select({
        id: proposedActions.id,
        runId: proposedActions.runId,
        status: proposedActions.status,
        isCanary: proposedActions.isCanary,
      })
      .from(proposedActions)
      .where(eq(proposedActions.caseId, input.caseId))
      .for('update');
    const holdsCanary = proposals.some(({ isCanary }) => isCanary);
    const open = proposals.find(({ status }) => status === OPEN_PROPOSAL);
    if (holdsCanary && !open) throw new RerunError(RERUN_FAILURE.conflict);

    const now = deps.now();
    const manualReruns = row.manualReruns + 1;
    await tx
      .update(cases)
      .set(
        holdsCanary
          ? { manualReruns }
          : {
              status: target,
              manualReruns,
              attempts: 0,
              nextAttemptAt: now,
              lockedUntil: null,
              claimToken: null,
            },
      )
      .where(eq(cases.id, input.caseId));
    const audit = {
      at: now,
      actor: input.operator.actor,
      keyId: input.operator.keyId,
      ip: input.meta.ip,
      userAgent: input.meta.userAgent,
    };
    await tx.insert(auditLog).values({
      ...audit,
      event: 'case.rerun',
      ref: input.caseId,
      detailMasked: maskJson({ from: row.status, manual_reruns: manualReruns }),
    });

    if (open) {
      const superseded = transition(OPEN_PROPOSAL, 'supersede', open.isCanary);
      if (!superseded) throw new RerunError(RERUN_FAILURE.conflict);
      await tx
        .update(proposedActions)
        .set({ status: superseded })
        .where(
          and(
            eq(proposedActions.id, open.id),
            eq(proposedActions.status, OPEN_PROPOSAL),
          ),
        );
      await tx.insert(auditLog).values({
        ...audit,
        event: 'proposal.supersede',
        ref: open.id,
        detailMasked: maskJson({ from: OPEN_PROPOSAL, to: superseded }),
      });
      if (holdsCanary) {
        await cloneCanary(tx, { runId: open.runId, caseId: input.caseId }, now);
      }
    }
    return {
      case_id: input.caseId,
      status: target,
      manual_reruns: manualReruns,
    };
  });
}
