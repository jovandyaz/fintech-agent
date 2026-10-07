import type { ProposedAction } from '@fintech-agent/contracts';

import { countViolation, stateViolation } from '../../../actions/allowed.js';
import type { RunEvidence, SeenTransaction } from './evidence.js';

/**
 * `ACTION_NOT_ALLOWED` (02 G5): the action falls outside its G2 row. The
 * count and repeats are checked on every id, the state on the transactions
 * the run saw; `EVIDENCE_UNSEEN` reports the others.
 */
export function actionNotAllowed(
  action: Pick<ProposedAction, 'type' | 'transaction_ids'>,
  evidence: RunEvidence,
): boolean {
  const seen = action.transaction_ids.flatMap((id): SeenTransaction[] => {
    const transaction = evidence.transactions.get(id);
    return transaction ? [transaction] : [];
  });
  return (
    countViolation(action.type, action.transaction_ids) !== null ||
    stateViolation(action.type, seen) !== null
  );
}
