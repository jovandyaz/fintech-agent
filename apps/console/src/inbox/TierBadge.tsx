import type { ReviewTier } from '@fintech-agent/contracts/console';

const HIGH: ReviewTier = 'high';

/** "Prioridad alta" for a high review tier (01: flags or a consequential action), nothing otherwise. */
export function TierBadge(props: { tier: ReviewTier | null }) {
  return props.tier === HIGH ? (
    <span className="tier-high">Prioridad alta</span>
  ) : null;
}
