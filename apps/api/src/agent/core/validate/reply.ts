import type {
  ProposedAction,
  Resolution,
  ValidationCode,
} from '@fintech-agent/contracts';

import { replyViolations } from '../../../replies/reply-checks.js';
import { hasCommitment } from './commitments.js';
import type { RunEvidence } from './evidence.js';
import { groundingAtoms, ungroundedAtoms } from './numbers.js';
import {
  COMMITMENT_PLACEHOLDERS,
  COMMITMENT_TOKEN_SOURCE,
  isPlaceholder,
  placeholdersIn,
  type Placeholder,
} from './placeholders.js';
import { TWO_FACTORS } from './predicates.js';

// A filled value joined to a letter or digit becomes text nobody validated
// ("1234567" + a date is an 8-digit run), so a placeholder stands apart.
const GLUED_PLACEHOLDER = /[\p{L}\p{N}]\{\{|\}\}[\p{L}\p{N}]|\}\}\{\{/u;

// A commitment fills as a whole sentence that starts with a capital and ends
// with a period, so anywhere but between sentence boundaries it renders broken
// text ("su dictamen Te daremos…").
const COMMITMENT_LITERALS = COMMITMENT_PLACEHOLDERS.map(
  (name) => `{{${name}}}`,
);
const SENTENCE_OPENING_PLACEHOLDERS = [...COMMITMENT_LITERALS, '{{nombre}}'];
const COMMITMENT_TOKEN = new RegExp(COMMITMENT_TOKEN_SOURCE, 'gu');
const SENTENCE_END = /[.!?…]/u;
const SENTENCE_OPENER = /[\p{Lu}¿¡]/u;
// Whitespace other than '\n', which may touch a commitment on its own.
const INLINE_SPACE = /[^\S\n]/u;

function startsSentenceAt(draft: string, index: number): boolean {
  let start = index;
  while (start > 0 && INLINE_SPACE.test(draft[start - 1]!)) start -= 1;
  if (start === 0 || draft[start - 1] === '\n') return true;
  return (
    start < index &&
    (SENTENCE_END.test(draft[start - 1]!) ||
      COMMITMENT_LITERALS.some((literal) => draft.endsWith(literal, start)))
  );
}

// One period may follow a commitment: fillPlaceholders drops it.
function endsSentenceAt(draft: string, end: number): boolean {
  const close = draft[end] === '.' ? end + 1 : end;
  let next = close;
  while (next < draft.length && INLINE_SPACE.test(draft[next]!)) next += 1;
  if (next === draft.length || draft[next] === '\n') return true;
  return (
    next > close &&
    (SENTENCE_OPENER.test(draft[next]!) ||
      SENTENCE_OPENING_PLACEHOLDERS.some((literal) =>
        draft.startsWith(literal, next),
      ))
  );
}

const commitmentInsideSentence = (draft: string): boolean =>
  [...draft.matchAll(COMMITMENT_TOKEN)].some(
    ({ index, 0: token }) =>
      !startsSentenceAt(draft, index) ||
      !endsSentenceAt(draft, index + token.length),
  );

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
const DICTAMEN_PLACEHOLDERS: readonly Placeholder[] = [
  'compromiso_dictamen',
  'fecha_limite_dictamen',
];
const ABONO_PLACEHOLDERS: readonly Placeholder[] = [
  'compromiso_abono',
  'fecha_limite_abono',
];

function commitmentPlaceholdersHold(
  names: readonly string[],
  action: ProposedAction,
  evidence: RunEvidence,
): boolean {
  const uses = (group: readonly Placeholder[]) =>
    group.some((placeholder) => names.includes(placeholder));
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
    names.some((name) => !isPlaceholder(name)) ||
    GLUED_PLACEHOLDER.test(draft) ||
    commitmentInsideSentence(draft)
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
