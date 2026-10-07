import {
  ResolutionSchema,
  VALIDATION_CODES,
  type Resolution,
  type ValidationCode,
} from '@fintech-agent/contracts';

import { actionNotAllowed } from './actions.js';
import type { RunEvidence } from './evidence.js';
import { actionSupported } from './predicates.js';
import { provenanceCodes } from './provenance.js';

/** A policy rule that failed against a transaction the run saw (02 G5). */
export interface PolicyConflict {
  rule_id: string;
  chunk_id: string;
  transaction_id: string;
  field: string;
}

export interface ValidationContext {
  evidence: RunEvidence;
}

export type ValidationOutcome =
  | {
      ok: true;
      resolution: Resolution;
      conflicts: readonly PolicyConflict[];
    }
  | { ok: false; codes: readonly ValidationCode[] };

const inCodeOrder = (codes: Iterable<ValidationCode>): ValidationCode[] => {
  const found = new Set(codes);
  return VALIDATION_CODES.filter((code) => found.has(code));
};

/**
 * Runs every 02 G5 check over one model output against what the run saw.
 * A failure lists its codes in `VALIDATION_CODES` order; an output that
 * does not parse fails `SCHEMA` alone, since nothing else can be read.
 */
export function validate(
  raw: unknown,
  context: ValidationContext,
): ValidationOutcome {
  const parsed = ResolutionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, codes: ['SCHEMA'] };
  const resolution = parsed.data;
  const codes = provenanceCodes(resolution, context.evidence);
  const action = resolution.proposed_action;
  if (actionNotAllowed(action, context.evidence)) {
    codes.push('ACTION_NOT_ALLOWED');
  } else if (!actionSupported(action, context.evidence)) {
    codes.push('ACTION_UNSUPPORTED');
  }
  return codes.length > 0
    ? { ok: false, codes: inCodeOrder(codes) }
    : { ok: true, resolution, conflicts: [] };
}
