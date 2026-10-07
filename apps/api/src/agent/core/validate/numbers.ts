import { localDateOf } from '../calendar.js';
import {
  QUALIFIERS,
  SPANISH_MONTHS,
  UNITS,
  alternation,
  foldForMatching,
} from './spanish.js';

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T/;
const CENTS_PER_PESO = 100;
const PESOS_PER_MIL = 1000;
const MONTHS_IN_YEAR = 12;
const MAX_DAY_OF_MONTH = 31;
const TWO_DIGITS = 2;
// A bare figure in this range reads as a year, not an amount.
const FIRST_YEAR = 1900;
const LAST_YEAR = 2099;
const CENTURY = 2000;
const AMOUNT_KEY = 'amount';
const INSTANT_KEY_SUFFIX = '_at';

const MONTH_NUMBER: Readonly<Record<string, number>> = {
  ...Object.fromEntries(SPANISH_MONTHS.map((name, index) => [name, index + 1])),
  setiembre: SPANISH_MONTHS.indexOf('septiembre') + 1,
};

// A dot or a space followed by three digits groups thousands ("$5.000",
// "50 000"); a dot with one or two digits is cents.
const PESOS = String.raw`(\d{1,3}(?:[,. ]\d{3})+|\d+)(?:\.(\d{1,2}))?(?!\d)`;
const CURRENCY_AFTER = String.raw`(?:pesos|mxn|m\.\s?n\.?|mn|dolares|dolar|usd|dlls|dls|euros|euro|eur|€)(?![a-z])`;
const CURRENCY_BEFORE = String.raw`(?:\b(?:mxn|usd|eur)|€)`;
// "$1.299,50", "1,5 mil", "3,5%": a comma before one or two final digits is
// decimal; before three it groups thousands.
const DECIMAL_COMMA = /\b(\d{1,3}(?:\.\d{3})+|\d+),(\d{1,2})\b/g;
const DOT = /\./g;
const ORDINAL = String.raw`(?:°|o|ro)?`;
const MONTH = `(${alternation(MONTH_NUMBER)})`;
// A year spelled out folds to "2,026", so a grouped year is a year too.
const YEAR_AFTER = String.raw`(?:,?\s(?:del?\s)?(\d{4}|2,0\d{2})(?![,.]?\d))?`;

// Words and masks before the last digits of a card ("terminación 4321",
// "****4321"), which are no amount. A mask is four marks, so Markdown bold
// or a bullet before an amount does not hide it.
const LAST_DIGITS_CUE = String.raw`(?:terminacion(?:\sen)?|termina\sen|terminada\sen|con\sfinal|digitos|[*•]{4})`;

// Each match yields its exact atom first, then the looser forms it grounds:
// a dated value grounds the same day without a year, and a qualified
// duration grounds the bare one.
interface Pattern {
  regex: RegExp;
  forms: (match: RegExpExecArray) => string[];
}

const THOUSANDS_SEPARATOR = /[,. ]/g;

const toCents = (pesos: string, cents = ''): number =>
  Number(pesos.replace(THOUSANDS_SEPARATOR, '')) * CENTS_PER_PESO +
  Number(cents.padEnd(TWO_DIGITS, '0'));

const amountForms = (match: RegExpExecArray): string[] => [
  `amount:${toCents(match[1]!, match[2])}`,
];

const pad = (value: number): string => String(value).padStart(TWO_DIGITS, '0');

const fullYear = (year: string | undefined): string | undefined =>
  year?.length === TWO_DIGITS ? String(CENTURY + Number(year)) : year;

function dateForms(
  rawYear: string | undefined,
  month: number,
  day: number,
): string[] {
  const year = rawYear?.replace(',', '');
  if (
    month < 1 ||
    month > MONTHS_IN_YEAR ||
    day < 1 ||
    day > MAX_DAY_OF_MONTH
  ) {
    return [];
  }
  const yearless = `date:--${pad(month)}-${pad(day)}`;
  return year
    ? [`date:${year}-${pad(month)}-${pad(day)}`, yearless]
    : [yearless];
}

const PATTERNS: readonly Pattern[] = [
  {
    regex: new RegExp(String.raw`\$\s?${PESOS}(\s?mil\b)?`, 'g'),
    forms: (m) => [
      `amount:${toCents(m[1]!, m[2]) * (m[3] ? PESOS_PER_MIL : 1)}`,
    ],
  },
  {
    regex: new RegExp(String.raw`${CURRENCY_BEFORE}\s?${PESOS}`, 'g'),
    forms: amountForms,
  },
  {
    regex: /\b(\d+)\s?centavos?\b/g,
    forms: (m) => [`amount:${Number(m[1])}`],
  },
  {
    regex: new RegExp(String.raw`\b${PESOS}\s?${CURRENCY_AFTER}`, 'g'),
    forms: amountForms,
  },
  {
    regex: new RegExp(
      String.raw`\b(\d+(?:\.\d+)?)\s?mil\b(?:\s${CURRENCY_AFTER})?`,
      'g',
    ),
    forms: (m) => [
      `amount:${Math.round(Number(m[1]) * PESOS_PER_MIL * CENTS_PER_PESO)}`,
    ],
  },
  {
    regex: /\b(\d+(?:\.\d+)?)\s?(?:%|por ciento\b)/g,
    forms: (m) => [`pct:${Number(m[1])}`],
  },
  {
    regex: new RegExp(
      String.raw`\b(\d+)\s?(${alternation(UNITS)})\b(?:\s(${alternation(QUALIFIERS)})\b)?`,
      'g',
    ),
    forms: (m) => {
      const bare = `dur:${Number(m[1])}:${UNITS[m[2]!]}`;
      return m[3] ? [`${bare}:${QUALIFIERS[m[3]]}`, bare] : [bare];
    },
  },
  {
    regex: new RegExp(
      String.raw`\b(\d{1,2})${ORDINAL}\s(?:de\s)?${MONTH}\b${YEAR_AFTER}`,
      'g',
    ),
    forms: (m) => dateForms(m[3], MONTH_NUMBER[m[2]!]!, Number(m[1])),
  },
  {
    regex: new RegExp(String.raw`\b${MONTH}\s(\d{1,2})\b${YEAR_AFTER}`, 'g'),
    forms: (m) => dateForms(m[3], MONTH_NUMBER[m[1]!]!, Number(m[2])),
  },
  {
    regex: /\b(\d{4})-(\d{2})-(\d{2})\b/g,
    forms: (m) => dateForms(m[1], Number(m[2]), Number(m[3])),
  },
  {
    regex: /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}|\d{2}))?\b/g,
    forms: (m) => dateForms(fullYear(m[3]), Number(m[2]), Number(m[1])),
  },
  // Last, so a currency, percentage, duration or date at the same place wins.
  // A bare figure is an amount when it has thousands, cents or three to seven
  // digits, unless it reads as a year or follows a last-digits cue; a count
  // has at most two.
  {
    regex: /\b(\d{1,3}(?:[,. ]\d{3})+|\d{5,7})(?:\.(\d{1,2}))?\b/g,
    forms: amountForms,
  },
  {
    regex: /\b(\d+)\.(\d{2})\b/g,
    forms: amountForms,
  },
  {
    regex: new RegExp(String.raw`(?<!${LAST_DIGITS_CUE}\s?)\b(\d{3,4})\b`, 'g'),
    forms: (m) => {
      const figure = Number(m[1]);
      return figure >= FIRST_YEAR && figure <= LAST_YEAR ? [] : amountForms(m);
    },
  },
];

// Leftmost match first, and a match that overlaps it is dropped, so
// "$5,000 pesos" is one amount, not two.
function matchesOf(text: string): string[][] {
  const normalized = foldForMatching(text).replace(
    DECIMAL_COMMA,
    (_, whole: string, fraction: string) =>
      `${whole.replace(DOT, '')}.${fraction}`,
  );
  const found: { start: number; end: number; forms: string[] }[] = [];
  for (const { regex, forms } of PATTERNS) {
    for (const match of normalized.matchAll(regex)) {
      const matchForms = forms(match);
      if (matchForms.length === 0) continue;
      found.push({
        start: match.index,
        end: match.index + match[0].length,
        forms: matchForms,
      });
    }
  }
  found.sort((a, b) => a.start - b.start);
  const kept: string[][] = [];
  let consumedTo = 0;
  for (const { start, end, forms } of found) {
    if (start < consumedTo) continue;
    kept.push(forms);
    consumedTo = end;
  }
  return kept;
}

/**
 * The amounts, percentages, durations and dates a text states (02 G5
 * `UNGROUNDED_NUMBER`), in order, as comparable atoms, whether written in
 * digits or spelled out in Spanish. Placeholders carry no digits, and a
 * count or an id is none of the four kinds, so neither is read.
 */
export function numberAtoms(text: string): string[] {
  return matchesOf(text).map(([exact]) => exact!);
}

function instantForms(value: string): string[] {
  if (!ISO_INSTANT.test(value) || Number.isNaN(Date.parse(value))) return [];
  const [year, month, day] = localDateOf(new Date(value))
    .split('-')
    .map(Number);
  return dateForms(String(year), month!, day!);
}

// Read by field meaning: an amount from `amount`, a date from an `*_at`
// instant. Free text such as a merchant descriptor is set by third parties,
// and a count such as `auth_factors` is no amount, so neither grounds.
function groundedForms(value: unknown, key = ''): string[] {
  if (key === AMOUNT_KEY && typeof value === 'number') {
    return [`amount:${Math.round(Math.abs(value) * CENTS_PER_PESO)}`];
  }
  if (key.endsWith(INSTANT_KEY_SUFFIX) && typeof value === 'string') {
    return instantForms(value);
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => groundedForms(item));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([field, item]) =>
      groundedForms(item, field),
    );
  }
  return [];
}

/**
 * Every atom the run can ground a reply number on: the amounts and instants
 * of the tool outputs it received (instants read as Mexico City dates) and
 * the text of the chunks it cited. Customer text is never passed in.
 */
export function groundingAtoms(sources: {
  outputs: readonly unknown[];
  citedTexts: readonly string[];
}): ReadonlySet<string> {
  return new Set([
    ...sources.outputs.flatMap((output) => groundedForms(output)),
    ...sources.citedTexts.flatMap((text) => matchesOf(text).flat()),
  ]);
}

/** The atoms of `text` that nothing in `grounding` supports. */
export function ungroundedAtoms(
  text: string,
  grounding: ReadonlySet<string>,
): string[] {
  return numberAtoms(text).filter((atom) => !grounding.has(atom));
}
