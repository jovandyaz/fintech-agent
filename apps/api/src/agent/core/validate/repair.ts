import type {
  ProposedAction,
  Resolution,
  ValidationCode,
} from '@fintech-agent/contracts';

import type { RunEvidence } from './evidence.js';
import { noneAction, validate, type ValidationContext } from './index.js';
import type { PolicyConflict } from './state-rules.js';

const RUN_KIND = { valid: 'valid', fallback: 'fallback' } as const;

interface Verdict {
  conflicts: readonly PolicyConflict[];
  /** The evidence the verdict was reached on, for Persist's fact flags. */
  evidence: RunEvidence;
}

export type ValidationRun =
  | (Verdict & {
      kind: typeof RUN_KIND.valid;
      resolution: Resolution;
      /** Whether the accepted output came from the repair turn. */
      repaired: boolean;
    })
  | (Verdict & {
      kind: typeof RUN_KIND.fallback;
      codes: readonly ValidationCode[];
      action: ProposedAction;
    });

/** The repair turn's evidence lost something the first turn saw. */
export class RepairEvidenceError extends Error {
  override readonly name = 'RepairEvidenceError';
}

const keepsKeys = (
  before: ReadonlyMap<string, unknown>,
  after: ReadonlyMap<string, unknown>,
): boolean => [...before.keys()].every((key) => after.has(key));

// Less evidence could only drop a policy conflict or a fact flag, so the
// repair's evidence must hold all the first turn's: a run only grows.
function holdsAll(before: RunEvidence, after: RunEvidence): boolean {
  return (
    keepsKeys(before.transactions, after.transactions) &&
    keepsKeys(before.speiStatuses, after.speiStatuses) &&
    keepsKeys(before.cardAuthorizations, after.cardAuthorizations) &&
    keepsKeys(before.chunks, after.chunks) &&
    (before.customer === null || after.customer !== null) &&
    (!before.injectionSignal || after.injectionSignal) &&
    (!before.crossCustomerLookup || after.crossCustomerLookup)
  );
}

/** The repair turn's output and the evidence of the run up to its end. */
export interface RepairTurn {
  output: unknown;
  evidence: RunEvidence;
}

/**
 * One validation, one repair turn with the codes as feedback, then the
 * fallback (02 G5): the second failure proposes `none`. `repair` appends the
 * codes to the run's messages and returns the model's next output with the
 * evidence of every tool result so far, since the repair turn may call tools;
 * the state rules stay the run's. It is called at most once. Evidence that
 * drops anything the first turn saw throws `RepairEvidenceError`; that and a
 * throw from either call propagate to the harness.
 */
export async function validateWithRepair(
  first: unknown,
  repair: (codes: readonly ValidationCode[]) => Promise<RepairTurn>,
  context: ValidationContext,
): Promise<ValidationRun> {
  const initial = validate(first, context);
  if (initial.ok) {
    return {
      kind: RUN_KIND.valid,
      resolution: initial.resolution,
      conflicts: initial.conflicts,
      evidence: context.evidence,
      repaired: false,
    };
  }
  const { output, evidence } = await repair(initial.codes);
  if (!holdsAll(context.evidence, evidence)) throw new RepairEvidenceError();
  const retried = validate(output, { ...context, evidence });
  if (retried.ok) {
    return {
      kind: RUN_KIND.valid,
      resolution: retried.resolution,
      conflicts: retried.conflicts,
      evidence,
      repaired: true,
    };
  }
  return {
    kind: RUN_KIND.fallback,
    codes: retried.codes,
    action: noneAction(
      `Validation failed after one repair: ${retried.codes.join(', ')}`,
    ),
    conflicts: retried.conflicts,
    evidence,
  };
}
