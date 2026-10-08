import {
  AWAITING_DECISION,
  MAX_MANUAL_RERUNS,
  RERUNNABLE_STATUSES,
  type CaseStatus,
} from '@fintech-agent/contracts';

const RERUNNABLE: ReadonlySet<CaseStatus> = new Set(RERUNNABLE_STATUSES);

/** Where a manual re-run takes the case, or null when it is refused. */
export function rerunTarget(
  status: CaseStatus,
  manualReruns: number,
): 'queued' | null {
  return RERUNNABLE.has(status) && manualReruns < MAX_MANUAL_RERUNS
    ? 'queued'
    : null;
}

/** Where a decision takes the case, or null when it is not waiting for one. */
export function resolveTarget(status: CaseStatus): 'resolved' | null {
  return status === AWAITING_DECISION ? 'resolved' : null;
}
