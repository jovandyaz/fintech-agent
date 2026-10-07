import type {
  ActionType,
  CaseFlag,
  ReviewTier,
} from '@fintech-agent/contracts';

const HIGH_ACTIONS: ReadonlySet<ActionType> = new Set([
  'open_dispute',
  'escalate_fraud',
]);

/**
 * The 01 rule Persist applies: `high` for an action that moves money or
 * escalates, or for any flag; `standard` otherwise. Never model confidence.
 */
export function reviewTierOf(
  type: ActionType,
  flags: readonly CaseFlag[],
): ReviewTier {
  return HIGH_ACTIONS.has(type) || flags.length > 0 ? 'high' : 'standard';
}
