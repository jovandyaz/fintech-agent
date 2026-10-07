import type { CaseFlag, Resolution } from '@fintech-agent/contracts';

import type { RunEvidence } from './evidence.js';
import { cardNotPresentBurst, fraudDeclineSeen } from './predicates.js';

/** Independent authentication factors from which 18.a lets a credit be declined. */
export const TWO_FACTORS = 2;
/** Prior approved or executed disputes that raise `first_party_signal` (synthetic). */
export const FIRST_PARTY_PRIOR_DISPUTES = 3;
/** How far back Persist counts those disputes, canaries excluded. */
export const FIRST_PARTY_LOOKBACK_DAYS = 120;

const DISPUTABLE_CARD_STATUSES: ReadonlySet<string> = new Set([
  'settled',
  'pending',
]);

function actionFactMismatch(
  resolution: Resolution,
  evidence: RunEvidence,
): boolean {
  if (resolution.proposed_action.type !== 'none') return false;
  const disputableCharge =
    resolution.category === 'unrecognized_card_charge' &&
    [...evidence.transactions.values()].some(
      (transaction) =>
        transaction.type === 'card_purchase' &&
        DISPUTABLE_CARD_STATUSES.has(transaction.status) &&
        transaction.auth_factors !== null &&
        transaction.auth_factors < TWO_FACTORS,
    );
  return (
    disputableCharge ||
    fraudDeclineSeen(evidence) ||
    cardNotPresentBurst(evidence)
  );
}

function firstPartySignal(
  resolution: Resolution,
  evidence: RunEvidence,
  priorOpenDisputes: number,
): boolean {
  const action = resolution.proposed_action;
  if (action.type !== 'open_dispute') return false;
  const twoFactorPurchase = action.transaction_ids.some((id) => {
    const factors = evidence.transactions.get(id)?.auth_factors;
    return factors !== null && factors !== undefined && factors >= TWO_FACTORS;
  });
  return twoFactorPurchase || priorOpenDisputes >= FIRST_PARTY_PRIOR_DISPUTES;
}

/**
 * The flags Persist computes from facts (02 G2 `action_fact_mismatch`, G3
 * `first_party_signal`). Neither blocks or changes the action; each raises
 * the tier and needs acknowledgment. `priorOpenDisputes` is the database
 * count of the customer's approved or executed disputes in the lookback.
 */
export function factFlags(
  resolution: Resolution,
  evidence: RunEvidence,
  history: { priorOpenDisputes: number },
): CaseFlag[] {
  const flags: CaseFlag[] = [];
  if (actionFactMismatch(resolution, evidence)) {
    flags.push('action_fact_mismatch');
  }
  if (firstPartySignal(resolution, evidence, history.priorOpenDisputes)) {
    flags.push('first_party_signal');
  }
  return flags;
}
