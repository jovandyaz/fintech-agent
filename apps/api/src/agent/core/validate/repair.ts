import type {
  ProposedAction,
  Resolution,
  ValidationCode,
} from '@fintech-agent/contracts';

import { validate, type ValidationContext } from './index.js';
import { policyConflicts, type PolicyConflict } from './state-rules.js';

const VALID = 'valid';
const FALLBACK = 'fallback';

export type ValidationRun =
  | {
      kind: typeof VALID;
      resolution: Resolution;
      conflicts: readonly PolicyConflict[];
      /** Whether the accepted output came from the repair turn. */
      repaired: boolean;
    }
  | {
      kind: typeof FALLBACK;
      codes: readonly ValidationCode[];
      action: ProposedAction;
      /** The run's policy conflicts, so Persist still flags them. */
      conflicts: readonly PolicyConflict[];
    };

/**
 * One validation, one repair turn with the codes as feedback, then the
 * fallback (02 G5): the second failure proposes `none`. `repair` appends the
 * codes to the run's messages and returns the model's next output; it is
 * called at most once. A throw from either call propagates to the harness.
 */
export async function validateWithRepair(
  first: unknown,
  repair: (codes: readonly ValidationCode[]) => Promise<unknown>,
  context: ValidationContext,
): Promise<ValidationRun> {
  const initial = validate(first, context);
  if (initial.ok) {
    return {
      kind: VALID,
      resolution: initial.resolution,
      conflicts: initial.conflicts,
      repaired: false,
    };
  }
  const retried = validate(await repair(initial.codes), context);
  if (retried.ok) {
    return {
      kind: VALID,
      resolution: retried.resolution,
      conflicts: retried.conflicts,
      repaired: true,
    };
  }
  return {
    kind: FALLBACK,
    codes: retried.codes,
    action: {
      type: 'none',
      transaction_ids: [],
      reason_code: 'insufficient_information',
      justification: `Validation failed after one repair: ${retried.codes.join(', ')}`,
    },
    conflicts: policyConflicts(context.evidence, context.stateRules),
  };
}
