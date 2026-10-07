import type {
  ProposedAction,
  Resolution,
  ValidationCode,
} from '@fintech-agent/contracts';

import { replyViolations } from '../../../replies/reply-checks.js';
import { hasCommitment } from './commitments.js';
import type { RunEvidence } from './evidence.js';
import { TWO_FACTORS } from './flags.js';
import { groundingAtoms, ungroundedAtoms } from './numbers.js';
import { PLACEHOLDERS, placeholdersIn } from './placeholders.js';

const KNOWN_PLACEHOLDERS: ReadonlySet<string> = new Set(PLACEHOLDERS);
// A filled value joined to a letter or digit becomes text nobody validated
// ("1234567" + a date is an 8-digit run), so a placeholder stands apart.
const GLUED_PLACEHOLDER = /[\p{L}\p{N}]\{\{|\}\}[\p{L}\p{N}]/u;

// Reads card authorization outputs only: a promise of credit rests on the
// factor count a status output confirms, never on a list row's copy.
const abonoHolds = (action: ProposedAction, evidence: RunEvidence): boolean =>
  action.type === 'open_dispute' &&
  action.transaction_ids.every((id) => {
    const factors = evidence.cardAuthorizations.get(id)?.auth_factors;
    return factors !== undefined && factors < TWO_FACTORS;
  });

// A bare deadline promises as much as its commitment does, so each date
// placeholder is held to the predicate of the commitment it belongs to.
const DICTAMEN_PLACEHOLDERS = ['compromiso_dictamen', 'fecha_limite_dictamen'];
const ABONO_PLACEHOLDERS = ['compromiso_abono', 'fecha_limite_abono'];

function commitmentPlaceholdersHold(
  names: readonly string[],
  action: ProposedAction,
  evidence: RunEvidence,
): boolean {
  const uses = (group: readonly string[]) =>
    names.some((name) => group.includes(name));
  if (uses(DICTAMEN_PLACEHOLDERS) && action.type !== 'open_dispute') {
    return false;
  }
  return !uses(ABONO_PLACEHOLDERS) || abonoHolds(action, evidence);
}

/**
 * The 02 G5 checks of `draft_reply`: placeholders from the approved set
 * (`{{nombre}}` only when the run read the customer), numbers grounded in a
 * tool output or a cited chunk, no promise outside a commitment placeholder
 * whose predicate holds, and the reply checks shared with `final_reply`.
 */
export function replyCodes(
  resolution: Resolution,
  evidence: RunEvidence,
): ValidationCode[] {
  const draft = resolution.draft_reply;
  const codes: ValidationCode[] = [];
  const names = placeholdersIn(draft);
  if (
    names.some((name) => !KNOWN_PLACEHOLDERS.has(name)) ||
    GLUED_PLACEHOLDER.test(draft)
  ) {
    codes.push('SCHEMA');
  }
  if (names.includes('nombre') && evidence.customer === null) {
    codes.push('EVIDENCE_UNSEEN');
  }
  const citedTexts = resolution.citations.flatMap(({ chunk_id }) => {
    const chunk = evidence.chunks.get(chunk_id);
    return chunk ? [chunk.content] : [];
  });
  const grounding = groundingAtoms({ outputs: evidence.outputs, citedTexts });
  if (ungroundedAtoms(draft, grounding).length > 0) {
    codes.push('UNGROUNDED_NUMBER');
  }
  if (
    hasCommitment(draft) ||
    !commitmentPlaceholdersHold(names, resolution.proposed_action, evidence)
  ) {
    codes.push('COMMITMENT_IN_REPLY');
  }
  codes.push(...replyViolations(draft));
  return codes;
}
