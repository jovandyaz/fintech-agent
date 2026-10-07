import {
  DAY_COMPARISON,
  type StateRule,
  type TxType,
} from '@fintech-agent/contracts';

import { businessDaysBetween, localDateOf } from '../calendar.js';
import type { RunEvidence } from './evidence.js';

/** The rules of one policy chunk, as Persist's corpus query returns them. */
export interface ChunkStateRules {
  chunk_id: string;
  quarantined: boolean;
  rules: readonly StateRule[];
}

/** A policy rule that failed against a transaction the run saw (02 G5). */
export interface PolicyConflict {
  rule_id: string;
  chunk_id: string;
  transaction_id: string;
  field: string;
}

interface StatusOutput {
  id: string;
  type: TxType;
  fields: Readonly<Record<string, unknown>>;
}

function statusOutputs(evidence: RunEvidence): StatusOutput[] {
  return [
    ...[...evidence.speiStatuses.values()].map((status) => ({
      id: status.id,
      type: status.type,
      fields: status,
    })),
    ...[...evidence.cardAuthorizations.values()].map((auth) => ({
      id: auth.id,
      type: 'card_purchase' as const,
      fields: auth,
    })),
  ];
}

function compare(value: number, comparison: string): boolean {
  const [, operator, operand] = DAY_COMPARISON.exec(comparison) ?? [];
  const bound = Number(operand);
  switch (operator) {
    case '>=':
      return value >= bound;
    case '<=':
      return value <= bound;
    case '>':
      return value > bound;
    case '<':
      return value < bound;
    case '=':
      return value === bound;
    default:
      return false;
  }
}

// A derived field the output cannot give (no return time) never matches, so
// a missing value can only skip a rule, never raise a conflict.
function returnedBusinessDaysAgo(
  output: StatusOutput,
  receivedAt: Date,
): number | null {
  const returnedAt = output.fields.returned_at;
  if (typeof returnedAt !== 'string') return null;
  const at = new Date(returnedAt);
  if (Number.isNaN(at.getTime())) return null;
  return businessDaysBetween(localDateOf(at), localDateOf(receivedAt));
}

function applies(
  rule: StateRule,
  output: StatusOutput,
  receivedAt: Date,
): boolean {
  const { type, status, returned_business_days_ago: daysAgo } = rule.applies_to;
  if (type !== undefined && type !== output.type) return false;
  if (status !== undefined && status !== output.fields.status) return false;
  if (daysAgo !== undefined) {
    const derived = returnedBusinessDaysAgo(output, receivedAt);
    if (derived === null || !compare(derived, daysAgo)) return false;
  }
  return true;
}

/**
 * Runs the `state_rules` of every non-quarantined chunk, cited or not, on
 * the status outputs the run received (01 `policy_chunks`, 02 G5
 * `POLICY_DATA_CONFLICT`). Only an explicit null fails a rule: a missing tool
 * call, or a field the output does not carry, never produces a conflict. Any conflict
 * forces `none`; a poisoned rule can do no more than that.
 */
export function policyConflicts(
  evidence: RunEvidence,
  corpus: readonly ChunkStateRules[],
): PolicyConflict[] {
  const outputs = statusOutputs(evidence);
  return corpus
    .filter(({ quarantined }) => !quarantined)
    .flatMap(({ chunk_id, rules }) =>
      rules.flatMap((rule) =>
        outputs
          .filter(
            (output) =>
              applies(rule, output, evidence.receivedAt) &&
              output.fields[rule.requires.field] === null,
          )
          .map((output) => ({
            rule_id: rule.id,
            chunk_id,
            transaction_id: output.id,
            field: rule.requires.field,
          })),
      ),
    );
}
