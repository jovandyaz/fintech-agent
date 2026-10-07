import {
  maskJson,
  type ActionType,
  type CaseFlag,
  type ReviewTier,
} from '@fintech-agent/contracts';

import type { auditLog } from '../database/schema.js';

const PROPOSAL_CREATED = 'proposal.create';

export interface ProposalAuditInput {
  at: Date;
  variant: string;
  promptVersion: string;
  actionId: string;
  runId: string;
  type: ActionType;
  flags: readonly CaseFlag[];
  reviewTier: ReviewTier;
}

/**
 * The audit row of a proposal, naming the agent version that made it (01
 * `audit_log`). Canary proposals write the same row, so the log cannot tell
 * them apart (02 G3).
 */
export function proposalAudit(
  input: ProposalAuditInput,
): typeof auditLog.$inferInsert {
  return {
    at: input.at,
    actor: `agent:case-copilot/${input.variant}@${input.promptVersion}`,
    event: PROPOSAL_CREATED,
    ref: input.actionId,
    detailMasked: maskJson({
      run_id: input.runId,
      type: input.type,
      flags: input.flags,
      review_tier: input.reviewTier,
    }),
  };
}
