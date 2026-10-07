import {
  MS_PER_HOUR,
  type ProposedAction,
  type SpeiStatus,
} from '@fintech-agent/contracts';

import { pastSpeiWindow } from '../../../actions/spei-window.js';
import type { RunEvidence } from './evidence.js';

/** Card-not-present charges at one merchant that make a burst (02 G2). */
export const CNP_BURST_CHARGES = 3;
const CNP_BURST_WINDOW_HOURS = 24;
const CNP_BURST_WINDOW_MS = CNP_BURST_WINDOW_HOURS * MS_PER_HOUR;

const isSettled = (status: SpeiStatus | undefined): status is SpeiStatus =>
  status?.status === 'settled';

/**
 * ≥ 3 card-not-present charges at the same merchant within 24 h among the
 * seen rows, list rows included: the burst is a pattern across rows, not a
 * status a single output confirms.
 */
export function cardNotPresentBurst(evidence: RunEvidence): boolean {
  const byMerchant = new Map<string, number[]>();
  for (const transaction of evidence.transactions.values()) {
    if (
      transaction.channel !== 'card_not_present' ||
      transaction.merchant === null
    ) {
      continue;
    }
    const at = Date.parse(transaction.created_at);
    if (Number.isNaN(at)) continue;
    const { merchant } = transaction;
    byMerchant.set(merchant, [...(byMerchant.get(merchant) ?? []), at]);
  }
  return [...byMerchant.values()].some((times) => {
    const sorted = times.toSorted((a, b) => a - b);
    return sorted.some((first, index) => {
      const last = sorted[index + CNP_BURST_CHARGES - 1];
      return last !== undefined && last - first <= CNP_BURST_WINDOW_MS;
    });
  });
}

/** Read from `get_card_authorization` outputs only; a list row has no decline reason. */
export function fraudDeclineSeen(evidence: RunEvidence): boolean {
  return [...evidence.cardAuthorizations.values()].some(
    (auth) =>
      auth.decision === 'declined' &&
      auth.decline_reason === 'card_blocked_fraud',
  );
}

function fraudSignal(evidence: RunEvidence): boolean {
  return (
    [...evidence.speiStatuses.values()].some(
      ({ hold_reason }) => hold_reason === 'fraud_review',
    ) ||
    fraudDeclineSeen(evidence) ||
    cardNotPresentBurst(evidence) ||
    evidence.injectionSignal ||
    evidence.crossCustomerLookup
  );
}

/**
 * The G2 fact predicate of a model's action, over the structured tool
 * outputs the run received only: status outputs, never a list row alone, and
 * never customer text or policy prose. False is `ACTION_UNSUPPORTED`.
 */
export function actionSupported(
  action: Pick<ProposedAction, 'type' | 'transaction_ids'>,
  evidence: RunEvidence,
): boolean {
  switch (action.type) {
    case 'open_dispute':
      return action.transaction_ids.every((id) => {
        if (evidence.cardAuthorizations.has(id)) return true;
        const status = evidence.speiStatuses.get(id);
        return (
          isSettled(status) &&
          status.type === 'spei_out' &&
          pastSpeiWindow(status.settled_at, evidence.now)
        );
      });
    case 'resend_cep':
      return action.transaction_ids.every((id) => {
        const status = evidence.speiStatuses.get(id);
        return isSettled(status) && status.cep_available;
      });
    case 'escalate_fraud':
      return fraudSignal(evidence);
    case 'none':
      return true;
  }
}
