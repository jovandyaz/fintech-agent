import type { CaseStatus } from '@fintech-agent/contracts';

/** 02 G3: the fourth manual re-run of a case is refused. */
export const MAX_MANUAL_RERUNS = 3;

const RERUNNABLE: ReadonlySet<CaseStatus> = new Set([
  'needs_review',
  'failed',
  'resolved',
]);

/** Where a manual re-run takes the case, or null when it is refused. */
export function rerunTarget(
  status: CaseStatus,
  manualReruns: number,
): 'queued' | null {
  return RERUNNABLE.has(status) && manualReruns < MAX_MANUAL_RERUNS
    ? 'queued'
    : null;
}

/** The one status a case is decided from (02 G3). */
export const AWAITING_DECISION: CaseStatus = 'needs_review';

/** Where a decision takes the case, or null when it is not waiting for one. */
export function resolveTarget(status: CaseStatus): 'resolved' | null {
  return status === AWAITING_DECISION ? 'resolved' : null;
}
