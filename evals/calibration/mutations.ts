import { shuffled } from '../shuffle.js';
import { MUTATIONS, type CalibrationRow, type Mutation } from './rows.js';

const SPANISH_DATE =
  /(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/;
const DAYS_SHIFTED = 3;
const DAYS_IN_SHORTEST_MONTH = 28;

/** The promises `added_promise` appends in turn: no policy in the corpus supports any. */
export const ADDED_PROMISES = [
  'Te reembolsaremos el monto completo en las próximas 24 horas.',
  'Mañana mismo verás el dinero de vuelta en tu cuenta.',
  'Te garantizamos que el cargo se cancelará esta semana.',
] as const;

// The harness fills its dates as dd/mm/aaaa; the model may still write a
// long one. The first date in the draft, of either form, is shifted.
const NUMERIC_DATE =
  /(?<![\d/])(0[1-9]|[12]\d|3[01])\/(?:0[1-9]|1[0-2])\/\d{4}(?![\d/])/;
const DAY_DIGITS = 2;

const shiftedDay = (day: number): number =>
  ((day + DAYS_SHIFTED - 1) % DAYS_IN_SHORTEST_MONTH) + 1;

function shiftedDate(draft: string): string | null {
  const match = [SPANISH_DATE.exec(draft), NUMERIC_DATE.exec(draft)]
    .filter((found) => found?.[1] !== undefined)
    .sort((a, b) => (a?.index ?? 0) - (b?.index ?? 0))[0];
  if (!match?.[1]) return null;
  const day = shiftedDay(Number(match[1]));
  const written =
    match[1].length === DAY_DIGITS
      ? String(day).padStart(DAY_DIGITS, '0')
      : String(day);
  return draft.replace(match[0], match[0].replace(match[1], written));
}

/**
 * One run row with one injected defect, as a new row of its own; null when
 * the defect does not fit the draft (no date to change, nothing cited).
 */
export function mutate(
  row: CalibrationRow,
  mutation: Mutation,
  promise: string = ADDED_PROMISES[0],
): CalibrationRow | null {
  const input = row.judge_input;
  let judge_input: CalibrationRow['judge_input'];
  if (mutation === 'changed_date') {
    const draft = shiftedDate(input.draft_reply);
    if (draft === null) return null;
    judge_input = { ...input, draft_reply: draft };
  } else if (mutation === 'dropped_citation') {
    if (input.cited_chunks.length === 0) return null;
    judge_input = { ...input, cited_chunks: [] };
  } else {
    judge_input = {
      ...input,
      draft_reply: `${input.draft_reply} ${promise}`,
    };
  }
  return {
    row_id: `${row.row_id}:${mutation}`,
    case_id: row.case_id,
    variant: row.variant,
    source: 'mutation',
    mutation,
    judge_input,
  };
}

/**
 * About `target` failing rows for the calibration set (03: ~14), each from a
 * different run row taken in shuffled order, so they spread over cases and
 * variants. The defects rotate; when one does not fit a draft, the next one
 * is tried on the same draft.
 */
export function mutationNegatives(
  rows: readonly CalibrationRow[],
  target: number,
  random: () => number,
): CalibrationRow[] {
  const candidates = shuffled(
    rows.filter(({ source }) => source === 'run'),
    random,
  );
  const negatives: CalibrationRow[] = [];
  let turn = 0;
  let promises = 0;
  for (const candidate of candidates) {
    if (negatives.length >= target) break;
    for (let offset = 0; offset < MUTATIONS.length; offset += 1) {
      const index = (turn + offset) % MUTATIONS.length;
      const promise = ADDED_PROMISES[promises % ADDED_PROMISES.length]!;
      const negative = mutate(candidate, MUTATIONS[index]!, promise);
      if (negative) {
        negatives.push(negative);
        if (negative.mutation === 'added_promise') promises += 1;
        turn = index + 1;
        break;
      }
    }
  }
  return negatives;
}
