import { localDateOf, localTimeOf } from '../calendar.js';

const CENTS_PER_PESO = 100;
const MONTHS_IN_YEAR = 12;
const MAX_DAY_OF_MONTH = 31;
const TWO_DIGITS = 2;
const GROUP_MARK = ',';

/**
 * The kinds of atom a reply figure reads as. A reply atom is grounded only
 * by an equal atom, so the reader and every grounding source spell them
 * through `atom`. `unread` is a figure no source can state.
 */
export const ATOM_KIND = {
  amount: 'amount',
  pct: 'pct',
  dur: 'dur',
  date: 'date',
  year: 'year',
  time: 'time',
  instant: 'instant',
  last4: 'last4',
  unread: 'unread',
} as const;
type AtomKind = (typeof ATOM_KIND)[keyof typeof ATOM_KIND];

/** An atom: its kind, then its parts, colon-separated ("dur:3:dia:habil"). */
export const atom = (
  kind: AtomKind,
  ...parts: readonly (string | number)[]
): string => [kind, ...parts].join(':');

/** Rounded to whole cents, so "$1,299.50" and an `amount` of 1299.5 agree. */
export const amountAtom = (pesos: number): string =>
  atom(ATOM_KIND.amount, Math.round(pesos * CENTS_PER_PESO));

/** A day, month, hour or minute as dates and times write it, two digits. */
export const pad = (value: number): string =>
  String(value).padStart(TWO_DIGITS, '0');

/** A spelled-out year folds to "2,026"; the group mark is not part of it. */
export const yearOf = (raw: string): string => raw.replace(GROUP_MARK, '');

/**
 * The atoms of a calendar date: exact, then the same day without a year,
 * then the year. An impossible day or month yields none.
 */
export function dateForms(
  rawYear: string | undefined,
  month: number,
  day: number,
): string[] {
  if (
    month < 1 ||
    month > MONTHS_IN_YEAR ||
    day < 1 ||
    day > MAX_DAY_OF_MONTH
  ) {
    return [];
  }
  const yearless = atom(ATOM_KIND.date, `--${pad(month)}-${pad(day)}`);
  if (rawYear === undefined) return [yearless];
  const year = yearOf(rawYear);
  return [
    atom(ATOM_KIND.date, `${year}-${pad(month)}-${pad(day)}`),
    yearless,
    atom(ATOM_KIND.year, year),
  ];
}

/**
 * An instant's Mexico City wall-clock time, to the second (`HH:MM:SS`) and
 * to the minute (`HH:MM`): plain times, not atoms.
 */
export function localClockOf(
  instant: Date,
): [toSecond: string, toMinute: string] {
  const toMinute = localTimeOf(instant);
  // Mexico City's offsets are whole hours since 1922: its seconds are UTC's.
  return [`${toMinute}:${pad(instant.getUTCSeconds())}`, toMinute];
}

/**
 * The atoms of a whole instant as its Mexico City date and time: to the
 * second, then to the minute. Comparing one atom, not a date and a time
 * apart, keeps two different instants from grounding it together.
 */
export function instantForms(
  instant: Date,
): [toSecond: string, toMinute: string] {
  const date = localDateOf(instant);
  const [toSecond, toMinute] = localClockOf(instant);
  return [
    atom(ATOM_KIND.instant, date, toSecond),
    atom(ATOM_KIND.instant, date, toMinute),
  ];
}
