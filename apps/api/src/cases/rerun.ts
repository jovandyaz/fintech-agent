import {
  maskJson,
  type ActionStatus,
  type CaseStatus,
} from '@fintech-agent/contracts';
import { and, eq } from 'drizzle-orm';

import { OPEN_PROPOSAL, transition } from '../approvals/transition.js';
import { REFUSAL } from '../common/errors/refusal.js';
import type { RequestMeta } from '../common/http/request-meta.js';
import type { Database } from '../database/index.js';
import {
  auditLog,
  canaryCases,
  cases,
  proposedActions,
} from '../database/schema.js';
import type { Operator } from '../operators/operator-tokens.js';
import { rerunTarget } from './case-transition.js';

const DECIDED_CANARY: ReadonlySet<ActionStatus> = new Set([
  'canary_caught',
  'canary_missed',
]);

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
 * first, as a decision locks it. A canary's case re-runs the same way, so the
 * worker replays its script; one whose canary was decided, or that lacks its
 * marker, cannot be re-run.
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
        status: proposedActions.status,
        isCanary: proposedActions.isCanary,
      })
      .from(proposedActions)
      .where(eq(proposedActions.caseId, input.caseId))
      .for('update');
    const open = proposals.find(({ status }) => status === OPEN_PROPOSAL);
    if (proposals.some(({ status }) => DECIDED_CANARY.has(status))) {
      throw new RerunError(RERUN_FAILURE.conflict);
    }
    // A canary without its marker would wait in the queue forever: the claim
    // never takes it, so it cannot reach the provider (02 G3).
    if (proposals.some(({ isCanary }) => isCanary)) {
      const [marker] = await tx
        .select({ caseId: canaryCases.caseId })
        .from(canaryCases)
        .where(eq(canaryCases.caseId, input.caseId));
      if (!marker) throw new RerunError(RERUN_FAILURE.conflict);
    }

    const now = deps.now();
    const manualReruns = row.manualReruns + 1;
    await tx
      .update(cases)
      .set({
        status: target,
        manualReruns,
        attempts: 0,
        nextAttemptAt: now,
        lockedUntil: null,
        claimToken: null,
      })
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
    }
    return {
      case_id: input.caseId,
      status: target,
      manual_reruns: manualReruns,
    };
  });
}
