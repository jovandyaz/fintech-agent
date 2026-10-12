import { CLOCK_CUE, LAST_HOUR, MINUTES_PER_HOUR } from './clock.js';
import { COUNT_NOUNS } from './count-nouns.js';

const THOUSAND = 1000;
const LONE_THOUSAND = 'mil';
// "Un 100%": an article before a written figure is no figure of its own.
const ARTICLES: ReadonlySet<string> = new Set(['un', 'una', 'uno']);
const DIGIT_NEXT = /^\s\d/;
// "¡Mil gracias!" is courtesy, not a figure. Denied by the noun that follows,
// so a lone "mil" in any other slot ("recibirás mil") still reads as 1,000.
const COURTESY = String.raw`(?:gracias|disculpas|perdones|besos|abrazos|bendiciones|veces)\b`;
const COURTESY_NEXT = new RegExp(String.raw`^\s${COURTESY}`);

const WORD_VALUES: Readonly<Record<string, number>> = {
  cero: 0,
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiun: 21,
  veintiuno: 21,
  veintiuna: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
  cien: 100,
  ciento: 100,
  doscientos: 200,
  doscientas: 200,
  trescientos: 300,
  trescientas: 300,
  cuatrocientos: 400,
  cuatrocientas: 400,
  quinientos: 500,
  quinientas: 500,
  seiscientos: 600,
  seiscientas: 600,
  setecientos: 700,
  setecientas: 700,
  ochocientos: 800,
  ochocientas: 800,
  novecientos: 900,
  novecientas: 900,
  mil: THOUSAND,
};

const WORD = Object.keys(WORD_VALUES)
  .toSorted((a, b) => b.length - a.length)
  .join('|');
const FIGURE_WORD = Object.keys(WORD_VALUES)
  .filter((word) => !ARTICLES.has(word))
  .join('|');
const ARTICLE_WORD = [...ARTICLES].join('|');
// "Los dos por ciento cincuenta pesos": a count before "por", so no percent.
// Not "las": "a las dos por 500 pesos" is a time.
const COUNTED = String.raw`\b(?:los|cada)\s`;
const PRONOUN_COUNTS: ReadonlySet<string> = new Set([
  'dos',
  'tres',
  'cuatro',
  'cinco',
  'seis',
  'siete',
  'ocho',
  'nueve',
  'diez',
]);
const PRONOUN_WORD = [...PRONOUN_COUNTS].join('|');
// A count noun later in the clause: the figure before it is a count, so a
// "por ciento" before it stays a percent ("los dos por ciento tres cargos").
const COUNT_AHEAD = String.raw`[^.;:]*\b(?:${COUNT_NOUNS.join('|')})\b`;
// "Por ciento 50 pesos" is 150: one or two digits that start no longer
// figure, grouped by a space before three digits too ("ciento 1 500").
const CIENTO_DIGITS = String.raw`\d{1,2}(?![\d.,:]?\d|\s\d{3}(?!\d))`;
// "mil" right after a digit is that figure's scale ("5 mil pesos" is read
// whole by the amount patterns). "por ciento" is a percent after a figure
// (a lone article is none: "cada uno por ciento cincuenta") or with no
// number word after it. Any other word folds, "cien" too: the reader has no
// "por cien" percent, so "11:20 por cien pesos" would hide 100.
const RUN = new RegExp(
  String.raw`\b(?!(?<=\bpor\s)ciento\b(?!\s(?:(?:y\s)?(?:${WORD})\b|${CIENTO_DIGITS})))(?!(?<=(?:\d\s?|\b(?!(?<=${COUNTED})(?:${PRONOUN_WORD})\b)(?:${FIGURE_WORD})\s(?:(?:y\s)?(?:${ARTICLE_WORD})\s)?)por\s)ciento\b)(?!(?<=\b(?:${PRONOUN_WORD})\spor\s)ciento\b(?=${COUNT_AHEAD}))(?!(?<=\d\s?)mil\b)(?:${WORD})(?:\s+(?:y\s+)?(?:${WORD}))*(?:(?<=\bciento)\s${CIENTO_DIGITS})?\b`,
  'g',
);
// Digits and a space before three digits group thousands, so "a las 3
// quinientos" folded bare would read as 3,500; a comma or dot glues them
// ("5,quinientos"), and an instant's "z" ends a figure as a digit does.
const AFTER_FIGURE = /(?<=\dz?\s|\d[,.])/y;
const APART = '· ';
const AND = /\s+y\s+/;
const THOUSAND_WORD = /\bmil\b/;
// After "a la(s)", an hour "y" minutes is never one sum, as with digits:
// "a las diez y cinco del 6" must not read as 15:00. Any other "y" there
// joins as usual ("a las mil y quinientos"). Sticky, so the cue is checked
// right before a run instead of searched for in all the text before it.
const AFTER_CLOCK_CUE = new RegExp(`(?<=${CLOCK_CUE})`, 'y');
// "Los tres se hicieron": a count of what came before, kept a word so it is
// not read. Only a small figure before a listed verb, so "los quinientos se
// abonan" and "los tres pesos" are still read.
const AFTER_LOS = /(?<=\blos\s)/y;
const AFTER_COUNTED = new RegExp(`(?<=${COUNTED})`, 'y');
const PRONOUN_COUNT_NEXT = /^\s(?:se|fueron|son|estan|tienen|aparecen)\b/;
// "Los dos por cien pesos": "por" and a figure after the count, one that
// "ciento" joins, and no count noun in the clause. An article, a lone 1, a
// courtesy "mil" or digits a letter or ordinal mark ends ("3D Secure",
// "3er") are no figure, so "los diez por una falla" still reads 10.
const LONE_ONE = String.raw`1(?![\d\p{L}_]|[.,]\d|\s\d{3})`;
// One figure taken whole, so no shorter run of its digits can pass for it.
const FIGURE_DIGITS = String.raw`(?!${LONE_ONE})\d+(?:[.,:]\d+)*(?![.,:]?[\d\p{L}ºª°_]|-\p{L})`;
const PRONOUN_POR_NEXT = new RegExp(
  String.raw`^\spor\s(?:ciento\s(?:(?:y\s)?(?:${WORD})\b|${CIENTO_DIGITS})|(?!ciento\b)(?:(?:${FIGURE_WORD})\b(?!\s${COURTESY})|${FIGURE_DIGITS}))(?!${COUNT_AHEAD})`,
  'u',
);
// "Cien" joins only a "mil" after it: "por cien cinco días" is 100 and 5.
const AFTER_CIEN = /(?<=\bcien)\s+(?!mil\b)/;
const SINGLE_DIGITS: ReadonlySet<string> = new Set([
  'cero',
  'uno',
  'dos',
  'tres',
  'cuatro',
  'cinco',
  'seis',
  'siete',
  'ocho',
  'nueve',
]);
const DIGITS = /^\d+$/;
const DECIMAL_BASE = 10;
const WHITESPACE = /\s+/;
// Grouped like a written figure, so "cinco mil" reads as the amount "5,000".
const THOUSANDS_GROUP = /\B(?=(\d{3})+(?!\d))/g;

function valueOf(run: string): number {
  let total = 0;
  let group = 0;
  for (const word of run.split(WHITESPACE)) {
    const value = DIGITS.test(word) ? Number(word) : WORD_VALUES[word];
    if (value === undefined) continue;
    if (value === THOUSAND) {
      total += (group === 0 ? 1 : group) * THOUSAND;
      group = 0;
    } else {
      group += value;
    }
  }
  return total + group;
}

// The largest power of ten that divides the figure: 100 for "ciento", 10
// for "veinte", 1 for "treinta y cinco".
function lowestPlace(value: number): number {
  if (value === 0) return 0;
  let place = 1;
  while (value % (place * DECIMAL_BASE) === 0) place *= DECIMAL_BASE;
  return place;
}

interface Piece {
  text: string;
  digits: string | null;
}

// "Uno dos tres cuatro": single digits read out in a row are a digit string,
// as a card's or a key's last digits are, never their sum. Words around such
// a run are figures of their own ("veinte uno dos tres" is 20 and 123).
const grouped = (value: number): string =>
  String(value).replace(THOUSANDS_GROUP, ',');

function piecesOf(part: string): Piece[] {
  const pieces: Piece[] = [];
  let words: string[] = [];
  let digits: string[] = [];
  // Ends a run of digit words; a "mil" right after a digit string scales it
  // ("dos tres mil" is 23,000), so it is taken in and reported as used.
  const flush = (next: string | null): boolean => {
    const run = digits;
    digits = [];
    if (run.length < 2) {
      words.push(...run);
      return false;
    }
    if (words.length > 0) pieces.push({ text: words.join(' '), digits: null });
    words = [];
    const value = run.map((word) => String(WORD_VALUES[word])).join('');
    const scaled = next === LONE_THOUSAND;
    pieces.push({
      text: run.join(' '),
      digits: scaled ? grouped(Number(value) * THOUSAND) : value,
    });
    return scaled;
  };
  for (const word of part.split(WHITESPACE)) {
    if (SINGLE_DIGITS.has(word)) digits.push(word);
    else if (!flush(word)) words.push(word);
  }
  flush(null);
  if (words.length > 0) pieces.push({ text: words.join(' '), digits: null });
  return pieces;
}

function figuresOf(run: string, afterClock: boolean): string[] {
  return run
    .split(AFTER_CIEN)
    .flatMap((segment, index) =>
      segmentFiguresOf(segment, afterClock && index === 0),
    );
}

// "y" joins when the next word is below the lowest place of what precedes
// it ("ciento y cinco", "treinta y cinco mil"); otherwise it separates two
// figures ("dos y tres días", "treinta y cinco y cuarenta", "dos mil y tres
// mil": a figure under a million has one "mil").
function segmentFiguresOf(run: string, afterClock: boolean): string[] {
  const groups: string[] = [];
  const digitStrings = new Map<number, string>();
  // Only the first piece of a part follows a "y", so only it may join.
  const pieces = run
    .split(AND)
    .flatMap((part) =>
      piecesOf(part).map((piece, at) => ({ ...piece, afterAnd: at === 0 })),
    );
  for (const piece of pieces) {
    const part = piece.text;
    if (piece.digits !== null) {
      digitStrings.set(groups.length, piece.digits);
      groups.push(part);
      continue;
    }
    const previous = piece.afterAnd ? groups.at(-1) : undefined;
    const next = WORD_VALUES[part.split(WHITESPACE)[0]!] ?? 0;
    const previousIsHour = afterClock && groups.length === 1;
    if (
      previous !== undefined &&
      !digitStrings.has(groups.length - 1) &&
      next < lowestPlace(valueOf(previous)) &&
      !(THOUSAND_WORD.test(previous) && THOUSAND_WORD.test(part)) &&
      !(
        previousIsHour &&
        valueOf(previous) <= LAST_HOUR &&
        valueOf(part) < MINUTES_PER_HOUR
      )
    ) {
      groups[groups.length - 1] = `${previous} ${part}`;
    } else {
      groups.push(part);
    }
  }
  return groups.map(
    (group, index) => digitStrings.get(index) ?? grouped(valueOf(group)),
  );
}

const isAfter = (cue: RegExp, text: string, offset: number): boolean => {
  cue.lastIndex = offset;
  return cue.test(text);
};

const keepsWord = (
  run: string,
  rest: string,
  after: { los: boolean; counted: boolean },
): boolean =>
  (run === LONE_THOUSAND && COURTESY_NEXT.test(rest)) ||
  (ARTICLES.has(run) && DIGIT_NEXT.test(rest)) ||
  (PRONOUN_COUNTS.has(run) &&
    ((after.los && PRONOUN_COUNT_NEXT.test(rest)) ||
      (after.counted && PRONOUN_POR_NEXT.test(rest))));

/**
 * Rewrites Spanish number words in lowercased, accent-free text as digits
 * ("cinco mil" → "5,000"), joining "y" by place value but never an hour and
 * its minutes after "a la(s)", so a figure spelled out reads like one in
 * digits. A word right after a figure comes back set apart ("3 · 500") so
 * the two never group. A word that is no figure in its context stays a
 * word: an article before digits ("un 100%"), a courtesy "mil" ("mil
 * gracias"), a count after "los" ("los tres se hicieron").
 */
export function foldNumberWords(text: string): string {
  return text.replace(RUN, (run: string, offset: number) => {
    const rest = text.slice(offset + run.length);
    const after = {
      los: isAfter(AFTER_LOS, text, offset),
      counted: isAfter(AFTER_COUNTED, text, offset),
    };
    if (keepsWord(run, rest, after)) return run;
    const figures = figuresOf(run, isAfter(AFTER_CLOCK_CUE, text, offset)).join(
      ' y ',
    );
    return isAfter(AFTER_FIGURE, text, offset) ? `${APART}${figures}` : figures;
  });
}
