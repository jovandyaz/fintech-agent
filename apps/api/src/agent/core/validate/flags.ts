import type {
  CaseCategory,
  CaseFlag,
  ProposedAction,
} from '@fintech-agent/contracts';

import type { RunEvidence } from './evidence.js';
import {
  CARD_PURCHASE,
  DISPUTABLE_CARD_STATUSES,
} from '../../../actions/allowed.js';
import {
  TWO_FACTORS,
  cardNotPresentBurst,
  fraudDeclineSeen,
} from './predicates.js';

// Prior approved or executed disputes that raise `first_party_signal` (synthetic).
const FIRST_PARTY_PRIOR_DISPUTES = 3;

/** What Persist flags: the accepted resolution, or the fallback's `none`. */
export interface FlagSubject {
  /** Null on a fallback, where no model output was accepted. */
  category: CaseCategory | null;
  proposed_action: ProposedAction;
}

// A fallback has no category to rule the charge out, so it reads as a
// possible unrecognized one: the suppressed dispute stays visible.
function actionFactMismatch(
  subject: FlagSubject,
  evidence: RunEvidence,
): boolean {
  if (subject.proposed_action.type !== 'none') return false;
  const disputableCharge =
    (subject.category === null ||
      subject.category === 'unrecognized_card_charge') &&
    [...evidence.transactions.values()].some(
      (transaction) =>
        transaction.type === CARD_PURCHASE &&
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
  subject: FlagSubject,
  evidence: RunEvidence,
  priorOpenDisputes: number,
): boolean {
  if (priorOpenDisputes >= FIRST_PARTY_PRIOR_DISPUTES) return true;
  const action = subject.proposed_action;
  if (action.type !== 'open_dispute') return false;
  return action.transaction_ids.some((id) => {
    const factors = evidence.transactions.get(id)?.auth_factors;
    return factors !== null && factors !== undefined && factors >= TWO_FACTORS;
  });
}

/**
 * The flags Persist computes from facts (02 G2 `action_fact_mismatch`, G3
 * `first_party_signal`). Neither blocks or changes the action; each raises
 * the tier and needs acknowledgment. `priorOpenDisputes` is the database
 * count of the customer's approved or executed disputes in the lookback.
 */
export function factFlags(
  subject: FlagSubject,
  evidence: RunEvidence,
  history: { priorOpenDisputes: number },
): CaseFlag[] {
  const flags: CaseFlag[] = [];
  if (actionFactMismatch(subject, evidence)) {
    flags.push('action_fact_mismatch');
  }
  if (firstPartySignal(subject, evidence, history.priorOpenDisputes)) {
    flags.push('first_party_signal');
  }
  return flags;
}
