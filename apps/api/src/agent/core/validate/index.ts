import {
  ResolutionSchema,
  VALIDATION_CODES,
  type ProposedAction,
  type Resolution,
  type ValidationCode,
} from '@fintech-agent/contracts';

import { actionNotAllowed } from './actions.js';
import type { RunEvidence } from './evidence.js';
import { actionSupported } from './predicates.js';
import { provenanceCodes } from './provenance.js';
import { replyCodes } from './reply.js';
import {
  policyConflicts,
  type ChunkStateRules,
  type PolicyConflict,
} from './state-rules.js';
import { FALLBACK_REASON } from '../fallback-reason.js';

export interface ValidationContext {
  evidence: RunEvidence;
  /** The non-quarantined corpus's rules, cited or not; required so none is skipped. */
  stateRules: readonly ChunkStateRules[];
}

export type ValidationOutcome =
  | {
      ok: true;
      resolution: Resolution;
      conflicts: readonly PolicyConflict[];
    }
  | {
      ok: false;
      codes: readonly ValidationCode[];
      conflicts: readonly PolicyConflict[];
    };

const inCodeOrder = (codes: Iterable<ValidationCode>): ValidationCode[] => {
  const found = new Set(codes);
  return VALIDATION_CODES.filter((code) => found.has(code));
};

/** The `none` action that code proposes in place of the model's. */
export const noneAction = (justification: string): ProposedAction => ({
  type: 'none',
  transaction_ids: [],
  reason_code: 'insufficient_information',
  justification,
});

function forcedNone(
  resolution: Resolution,
  conflicts: readonly PolicyConflict[],
): Resolution {
  const ruleIds = [...new Set(conflicts.map(({ rule_id }) => rule_id))];
  return {
    ...resolution,
    proposed_action: noneAction(FALLBACK_REASON.policyConflict(ruleIds)),
  };
}

/**
 * Runs every 02 G5 check over one model output against what the run saw.
 * A failure lists its codes in `VALIDATION_CODES` order; an output that
 * does not parse fails `SCHEMA` alone, since nothing else can be read. A
 * `POLICY_DATA_CONFLICT` is not a code: it replaces the action with `none`
 * before the other checks run, so the reply is held to the forced action.
 * Conflicts come from the evidence alone, so a failure carries them too.
 */
export function validate(
  raw: unknown,
  context: ValidationContext,
): ValidationOutcome {
  const { evidence } = context;
  const conflicts = policyConflicts(evidence, context.stateRules);
  const parsed = ResolutionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, codes: ['SCHEMA'], conflicts };
  const resolution =
    conflicts.length > 0 ? forcedNone(parsed.data, conflicts) : parsed.data;
  const codes = provenanceCodes(resolution, evidence);
  const action = resolution.proposed_action;
  if (actionNotAllowed(action, evidence)) {
    codes.push('ACTION_NOT_ALLOWED');
  } else if (!actionSupported(action, evidence)) {
    codes.push('ACTION_UNSUPPORTED');
  }
  codes.push(...replyCodes(resolution, evidence));
  return codes.length > 0
    ? { ok: false, codes: inCodeOrder(codes), conflicts }
    : { ok: true, resolution, conflicts };
}
