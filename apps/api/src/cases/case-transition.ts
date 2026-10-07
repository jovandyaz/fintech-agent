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
