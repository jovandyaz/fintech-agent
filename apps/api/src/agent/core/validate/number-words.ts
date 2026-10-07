import { CLOCK_CUE, LAST_HOUR, MINUTES_PER_HOUR } from './clock.js';

const THOUSAND = 1000;
const LONE_THOUSAND = 'mil';
// "Un 100%": an article before a written figure is no figure of its own.
const ARTICLES: ReadonlySet<string> = new Set(['un', 'una', 'uno']);
const DIGIT_NEXT = /^\s\d/;
// "¡Mil gracias!" is courtesy, not a figure. Denied by the noun that follows,
// so a lone "mil" in any other slot ("recibirás mil") still reads as 1,000.
const COURTESY_NEXT =
  /^\s(?:gracias|disculpas|perdones|besos|abrazos|bendiciones|veces)\b/;

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
// Not after a digit ("5 mil pesos" is read as a whole by the amount
// patterns) nor in "por ciento", where "ciento" is no figure.
const RUN = new RegExp(
  String.raw`(?<!\d\s?|\bpor\s)\b(?:${WORD})(?:\s+(?:y\s+)?(?:${WORD}))*\b`,
  'g',
);
const AND = /\s+y\s+/;
const THOUSAND_WORD = /\bmil\b/;
// After "a la(s)", an hour "y" minutes is never one sum, as with digits:
// "a las diez y cinco del 6" must not read as 15:00. Any other "y" there
// joins as usual ("a las mil y quinientos"). Sticky, so the cue is checked
// right before a run instead of searched for in all the text before it.
const AFTER_CLOCK_CUE = new RegExp(`(?<=${CLOCK_CUE})`, 'y');
const DECIMAL_BASE = 10;
const WHITESPACE = /\s+/;
// Grouped like a written figure, so "cinco mil" reads as the amount "5,000".
const THOUSANDS_GROUP = /\B(?=(\d{3})+(?!\d))/g;

function valueOf(run: string): number {
  let total = 0;
  let group = 0;
  for (const word of run.split(WHITESPACE)) {
    const value = WORD_VALUES[word];
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

// "y" joins when the next word is below the lowest place of what precedes
// it ("ciento y cinco", "treinta y cinco mil"); otherwise it separates two
// figures ("dos y tres días", "treinta y cinco y cuarenta", "dos mil y tres
// mil": a figure under a million has one "mil").
function figuresOf(run: string, afterClock: boolean): number[] {
  const groups: string[] = [];
  for (const part of run.split(AND)) {
    const previous = groups.at(-1);
    const next = WORD_VALUES[part.split(WHITESPACE)[0]!] ?? 0;
    const previousIsHour = afterClock && groups.length === 1;
    if (
      previous !== undefined &&
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
  return groups.map(valueOf);
}

const isAfterClockCue = (text: string, offset: number): boolean => {
  AFTER_CLOCK_CUE.lastIndex = offset;
  return AFTER_CLOCK_CUE.test(text);
};

const keepsWord = (run: string, rest: string): boolean =>
  (run === LONE_THOUSAND && COURTESY_NEXT.test(rest)) ||
  (ARTICLES.has(run) && DIGIT_NEXT.test(rest));

/**
 * Rewrites Spanish number words as digits ("cuarenta y cinco días" → "45
 * días", "cinco mil" → "5,000") so a figure spelled out is read like one
 * written in digits. Takes text already lowercased and stripped of accents.
 * "y" joins by place value, never two parts that each carry "mil", and
 * after "a la(s)" never an hour and its minutes. An article ("un", "una", "uno")
 * becomes 1 unless a written figure follows it ("un 100%"); a lone "mil"
 * before a courtesy noun ("mil gracias") stays a word.
 */
export function foldNumberWords(text: string): string {
  return text.replace(RUN, (run: string, offset: number) => {
    const rest = text.slice(offset + run.length);
    return keepsWord(run, rest)
      ? run
      : figuresOf(run, isAfterClockCue(text, offset))
          .map((figure) => String(figure).replace(THOUSANDS_GROUP, ','))
          .join(' y ');
  });
}
