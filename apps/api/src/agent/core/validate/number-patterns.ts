import {
  ATOM_KIND,
  amountAtom,
  atom,
  dateForms,
  pad,
  yearOf,
} from './atoms.js';
import {
  CLOCK_CUE,
  DAY_PARTS,
  type DayPart,
  HOUR_12,
  HOUR_24,
  MINUTE,
  MINUTES_END,
  PAST_LAST_HOUR,
  SPOKEN_MINUTE,
} from './clock.js';
import {
  GROUPED,
  QUALIFIERS,
  QUALIFIER_WORD,
  RANGE_DASH,
  RANGE_JOIN,
  SPANISH_MONTHS,
  UNITS,
  UNIT_WORD,
  alternation,
} from './spanish.js';

const PESOS_PER_MIL = 1000;
const PESOS_PER_MILLION = 1_000_000;
const HOURS_PER_HALF_DAY = 12;
const TWO_DIGITS = 2;
const CENTURY = 2000;
const LAST_SMALL_HOUR = 5;
const MAX_WORDS_BEFORE_HALF = 2;
const ON_THE_HOUR = '00';
const AFTERNOON = 'p';
const NIGHT: DayPart = 'noche';
// "1" alone is the article ("un momento", "una aclaración") once number
// words are folded, so it is read only where a currency or unit claims it.
const ARTICLE = '1';
const FIGURE = 'n';
const LOW = 'low';
const HIGH = 'high';
const UNREAD = atom(ATOM_KIND.unread);

/**
 * How a pattern treats a cited chunk: `read` grounds what it reads, `skip`
 * reads nothing there (fail-closed fallbacks and card digits check a draft
 * only), `mask` claims its span and yields nothing, so the parts of a span
 * a chunk states ("una hora y media") ground nothing either.
 */
export const CHUNK_READING = {
  read: 'read',
  skip: 'skip',
  mask: 'mask',
} as const;
type ChunkReading = (typeof CHUNK_READING)[keyof typeof CHUNK_READING];

type Groups = Readonly<Record<string, string | undefined>>;

/** One reading: its atoms come exact first, then the looser forms it grounds. */
export interface Pattern {
  regex: RegExp;
  forms: (groups: Groups) => string[];
  chunk: ChunkReading;
}

const MORNING_PARTS: ReadonlySet<string> = new Set<DayPart>([
  'manana',
  'madrugada',
]);
const SPOKEN_MINUTES: Readonly<Record<string, string>> = {
  media: '30',
  cuarto: '15',
};
const MONTH_NUMBER: Readonly<Record<string, number>> = {
  ...Object.fromEntries(SPANISH_MONTHS.map((name, index) => [name, index + 1])),
  setiembre: SPANISH_MONTHS.indexOf('septiembre') + 1,
};
// No singulars: once accents go, "pasó" and "cuenta" read as nouns, so
// "1500 pasó" would hide 1500. Only "1" takes a singular, and it is no figure.
const COUNT_NOUNS = [
  'movimientos',
  'cargos',
  'transacciones',
  'operaciones',
  'compras',
  'transferencias',
  'pagos',
  'intentos',
  'veces',
  'pasos',
  'digitos',
  'documentos',
  'aclaraciones',
  'casos',
  'tarjetas',
  'cuentas',
  'opciones',
  'cobros',
  'abonos',
  'depositos',
  'reembolsos',
  'devoluciones',
  'retiros',
  'comercios',
  'solicitudes',
] as const;

const INTEGER = String.raw`(?:${GROUPED}|\d+)`;
const DECIMALS = String.raw`\d{1,2}`;
const fractionOf = (name: string): string => `${name}Fraction`;
// Every kind shares this one figure reading, so "2.500 mil", "2.500 días"
// and "2.500%" never disagree on what 2.500 is.
const figure = (name: string, integer = INTEGER): string =>
  String.raw`(?<${name}>${integer})(?:\.(?<${fractionOf(name)}>${DECIMALS}))?(?!\d)`;
// Capture-free: the half reading never values its figure.
const FIGURE_SPAN = String.raw`${INTEGER}(?:\.${DECIMALS})?(?!\d)`;
// After "a la(s)" a half needs a figure that cannot be a bare hour: grouped,
// with decimals or past the last hour, since "a las 3 y media" is a time.
const NON_HOUR_SPAN = String.raw`(?:${GROUPED}(?:\.${DECIMALS})?|\d+\.${DECIMALS}|${PAST_LAST_HOUR})(?!\d)`;
// A date or an hour that stopped before this would take the head of "5.500"
// or "5 500" and leave its tail an amount a tool could ground.
const FIGURE_TAIL = String.raw`[.,]\d|\s\d{3}(?!\d)`;
const GROUP_SEPARATOR = /[,. ]/g;

const CURRENCY_AFTER = String.raw`(?:pesos|peso|mxn|m\.\s?n\.?|mn|dolares|dolar|usd|dlls|dls|euros|euro|eur|€)(?![a-z])`;
const CURRENCY_BEFORE = String.raw`(?:\b(?:mxn|usd|eur)|€)`;
const CURRENCY_MARK = String.raw`(?:\$|${CURRENCY_BEFORE})`;
const THOUSANDS_WORD = String.raw`(?:mil|k)\b`;
const MILLIONS_WORD = String.raw`(?:millon(?:es)?|mdp|mdd)\b`;
const PERCENT = String.raw`(?:%|por ciento\b)`;
const CENTAVOS = String.raw`centavos?\b`;
// Without the remainder "1 millón 200 mil" splits into two figures, each of
// which a tool amount could ground on its own.
const MILLIONS = String.raw`(?<millions>\s?${MILLIONS_WORD})(?:\s(?:y\s)?(?<rest>${INTEGER})(?![\d.])(?<restThousands>\s?${THOUSANDS_WORD})?)?`;
const UNIT_AND_QUALIFIER = String.raw`(?<unit>${UNIT_WORD})(?:\s(?<qualifier>${QUALIFIER_WORD}))?`;
// A date or a time starts before its last figure, so without these it would
// swallow a figure another reading owns: "5-10 mil pesos", "octubre 5 mil",
// "a las 14:30 mil pesos", "5-3 días". A time keeps a unit ("14:30 hrs").
const MARK_AFTER = String.raw`\s?(?:${THOUSANDS_WORD}|${MILLIONS_WORD}|${PERCENT}|${CENTAVOS}|${CURRENCY_AFTER})`;
const KIND_AFTER = String.raw`(?:${MARK_AFTER}|\s?${UNIT_WORD})`;
const DATE_END = String.raw`(?!${KIND_AFTER}|${FIGURE_TAIL})`;
const COUNT_FOLLOWS = String.raw`\s?(?:${COUNT_NOUNS.join('|')})\b`;
const COUNT_ORDINAL = String.raw`(?:er|ra|ro|do|da|to|ta|vo|va|no|na|mo|ma|o|a|°)(?![a-z])`;

const MONTH = `(?<monthName>${alternation(MONTH_NUMBER)})`;
const DAY_ORDINAL = String.raw`(?:°|o|ro)?`;
// A year spelled out folds to "2,026" or "1,999", so a grouped year is one
// too, unless another group follows it ("2,026 500").
const YEAR = String.raw`(?<year>(?:19|20)\d{2}|(?:1,9|2,0)\d{2}(?!${FIGURE_TAIL}))(?![.,]?\d)`;
const YEAR_AFTER = String.raw`(?:,?\s(?:del?\s)?${YEAR}(?!${KIND_AFTER}))?`;
// Only words no amount follows: "de", "en" or "hasta 2026" may be pesos.
const YEAR_CUE = String.raw`\b(?:ano|anos|este|durante)\s`;

const DAY_PART = String.raw`de\sla\s(?<dayPart>${DAY_PARTS.join('|')})\b`;

// A mask is four marks, so Markdown bold or a bullet before an amount does
// not turn it into card digits.
const LAST_DIGITS_CUE = String.raw`(?:\b(?:terminacion(?:\sen)?|termina\sen|terminada\sen|con\sfinal|digitos)\s?|[*•x]{4}\s?)`;

const wordsBeforeHalf = (atLeast: number): string =>
  String.raw`(?:\s?[a-z]+){${atLeast},${MAX_WORDS_BEFORE_HALF}}`;

const valueOf = (groups: Groups, name: string): number => {
  const fraction = groups[fractionOf(name)];
  return (
    Number(groups[name]!.replace(GROUP_SEPARATOR, '')) +
    (fraction ? Number(`0.${fraction}`) : 0)
  );
};

const scaledAmount = (groups: Groups): string[] => {
  const scale =
    (groups.thousands ? PESOS_PER_MIL : 1) *
    (groups.millions ? PESOS_PER_MILLION : 1);
  const rest = groups.rest
    ? Number(groups.rest.replace(GROUP_SEPARATOR, '')) *
      (groups.restThousands ? PESOS_PER_MIL : 1)
    : 0;
  return [amountAtom(valueOf(groups, FIGURE) * scale + rest)];
};

const durationForms = (
  count: number,
  unit: string,
  qualifier: string | undefined,
): string[] => {
  const bare = atom(ATOM_KIND.dur, count, UNITS[unit]!);
  return qualifier
    ? [atom(ATOM_KIND.dur, count, UNITS[unit]!, QUALIFIERS[qualifier]!), bare]
    : [bare];
};

// Otherwise "de 2 a 3 días" leaves 2 an amount no chunk can ground.
const rangeForms = (groups: Groups): string[] => {
  const low = valueOf(groups, LOW);
  return low < valueOf(groups, HIGH)
    ? durationForms(low, groups.unit!, groups.qualifier)
    : [];
};

const timeAtom = (hour: number, minutes: string): string =>
  atom(ATOM_KIND.time, `${pad(hour)}:${minutes}`);

const to24h = (hour: number, meridiem: string): number =>
  (hour % HOURS_PER_HALF_DAY) +
  (meridiem === AFTERNOON ? HOURS_PER_HALF_DAY : 0);

// "Las 12 de la noche" is midnight and "la 1 de la noche" still a.m.
const dayPartHour = (hour: number, dayPart: string | undefined): number => {
  if (dayPart === undefined || MORNING_PARTS.has(dayPart)) return hour;
  if (dayPart === NIGHT && hour === HOURS_PER_HALF_DAY) return 0;
  if (dayPart === NIGHT && hour <= LAST_SMALL_HOUR) return hour;
  return to24h(hour, AFTERNOON);
};

const clockMinutes = (groups: Groups): string => {
  if (groups.minute !== undefined) return groups.minute;
  if (groups.spoken === undefined) return ON_THE_HOUR;
  return SPOKEN_MINUTES[groups.spoken] ?? pad(Number(groups.spoken));
};

const fullYear = (year: string | undefined): string | undefined =>
  year?.length === TWO_DIGITS ? String(CENTURY + Number(year)) : year;

const namedDateForms = (groups: Groups): string[] =>
  dateForms(groups.year, MONTH_NUMBER[groups.monthName!]!, Number(groups.day));

const pattern = (
  source: string,
  forms: Pattern['forms'],
  chunk: ChunkReading = CHUNK_READING.read,
  flags = 'g',
): Pattern => ({ regex: new RegExp(source, flags), forms, chunk });

/**
 * Every reading of the number reader, in order. Two rules make the order
 * load-bearing: the leftmost match wins and drops what overlaps it, and at
 * the same start the earlier entry wins. So the half reading comes first, a
 * kind with an explicit mark comes before a date or a time that could start
 * at the same figure, and the fail-closed amount readings come last.
 */
export const PATTERNS: readonly Pattern[] = [
  pattern(
    String.raw`(?:${CURRENCY_MARK}\s?${FIGURE_SPAN}${wordsBeforeHalf(0)}|(?<!${CLOCK_CUE})(?<!\d)${FIGURE_SPAN}${wordsBeforeHalf(0)}|(?<=${CLOCK_CUE})(?:${FIGURE_SPAN}${wordsBeforeHalf(1)}|${NON_HOUR_SPAN}))\sy\smedi[oa]\b`,
    () => [UNREAD],
    CHUNK_READING.mask,
  ),
  pattern(String.raw`[^\P{N}0-9]+`, () => [UNREAD], CHUNK_READING.skip, 'gu'),
  pattern(
    String.raw`${CURRENCY_MARK}\s?${figure(FIGURE)}(?<thousands>\s?${THOUSANDS_WORD})?(?:${MILLIONS})?`,
    scaledAmount,
  ),
  pattern(String.raw`\b${figure(FIGURE)}\s?${CENTAVOS}`, (groups) => [
    atom(ATOM_KIND.amount, Math.round(valueOf(groups, FIGURE))),
  ]),
  pattern(String.raw`\b${figure(FIGURE)}\s?${CURRENCY_AFTER}`, scaledAmount),
  pattern(
    String.raw`\b${figure(FIGURE)}(?<thousands>\s?${THOUSANDS_WORD})?\s?${MILLIONS}`,
    scaledAmount,
  ),
  pattern(String.raw`\bmedio\smillon\b`, () => [
    amountAtom(PESOS_PER_MILLION / 2),
  ]),
  pattern(
    String.raw`\bmedi[oa]\s${UNIT_WORD}`,
    () => [UNREAD],
    CHUNK_READING.skip,
  ),
  pattern(String.raw`\b${MILLIONS_WORD}`, () => [UNREAD], CHUNK_READING.skip),
  pattern(
    String.raw`\b${figure(FIGURE)}\s?(?<thousands>${THOUSANDS_WORD})(?:\s${CURRENCY_AFTER})?`,
    scaledAmount,
  ),
  pattern(String.raw`\b${figure(FIGURE)}\s?${PERCENT}`, (groups) => [
    atom(ATOM_KIND.pct, valueOf(groups, FIGURE)),
  ]),
  pattern(
    String.raw`(?<=\b(?:de|entre)\s)${figure(LOW)}(?=\s${RANGE_JOIN}\s${figure(HIGH)}\s?${UNIT_AND_QUALIFIER})`,
    rangeForms,
  ),
  pattern(
    String.raw`\b${figure(LOW)}(?=\s?${RANGE_DASH}\s?${figure(HIGH)}\s?${UNIT_AND_QUALIFIER})`,
    rangeForms,
  ),
  pattern(String.raw`\b${figure(FIGURE)}\s?${UNIT_AND_QUALIFIER}`, (groups) =>
    durationForms(valueOf(groups, FIGURE), groups.unit!, groups.qualifier),
  ),
  pattern(
    String.raw`\b(?<day>\d{1,2})${DAY_ORDINAL}\s(?:de\s)?${MONTH}\b${YEAR_AFTER}`,
    namedDateForms,
  ),
  pattern(
    String.raw`\b${MONTH}\s(?<day>\d{1,2})\b${DATE_END}${YEAR_AFTER}`,
    namedDateForms,
  ),
  pattern(
    String.raw`\b(?<isoYear>\d{4})-(?<month>\d{2})-(?<day>\d{2})\b${DATE_END}`,
    (groups) =>
      dateForms(groups.isoYear, Number(groups.month), Number(groups.day)),
  ),
  pattern(
    String.raw`\b(?<day>\d{1,2})[/-](?<month>\d{1,2})(?:[/-](?<shortYear>\d{4}|\d{2}))?\b${DATE_END}`,
    (groups) =>
      dateForms(
        fullYear(groups.shortYear),
        Number(groups.month),
        Number(groups.day),
      ),
  ),
  pattern(
    String.raw`\b(?<hour>${HOUR_12})(?::(?<minute>${MINUTE}))?\s?(?<meridiem>[ap])\.?\s?m\b\.?`,
    (groups) => [
      timeAtom(
        to24h(Number(groups.hour), groups.meridiem!),
        groups.minute ?? ON_THE_HOUR,
      ),
    ],
  ),
  pattern(
    String.raw`(?<=${CLOCK_CUE})(?<hour>${HOUR_24})(?:[.:](?<minute>${MINUTE})|\sy\s(?<spoken>${alternation(SPOKEN_MINUTES)}|${SPOKEN_MINUTE}(?=${MINUTES_END})))?(?![\d:])(?!${FIGURE_TAIL}|${MARK_AFTER}|${COUNT_FOLLOWS})(?:\s${DAY_PART})?`,
    (groups) => [
      timeAtom(
        dayPartHour(Number(groups.hour), groups.dayPart),
        clockMinutes(groups),
      ),
    ],
  ),
  pattern(
    String.raw`\b(?<hour>${HOUR_24}):(?<minute>${MINUTE})\b(?!${MARK_AFTER})`,
    (groups) => [timeAtom(Number(groups.hour), groups.minute!)],
  ),
  pattern(
    String.raw`(?<=${LAST_DIGITS_CUE})(?<digits>[a-z\d]*\d[a-z\d]*)`,
    (groups) => [atom(ATOM_KIND.last4, groups.digits!)],
    CHUNK_READING.skip,
  ),
  pattern(String.raw`(?<=${YEAR_CUE})${YEAR}`, (groups) => [
    atom(ATOM_KIND.year, yearOf(groups.year!)),
  ]),
  // Last, so the reader fails closed: whatever no reading above claims is an
  // amount, glued to a letter, "_" or a mark too ("MN5000", "_5000_").
  // Splitting a figure only adds atoms. A grouped figure masks its span in a
  // chunk, or a chunk's "1 500 días" would ground "500 días".
  pattern(
    String.raw`(?<!\d)${figure(FIGURE, GROUPED)}`,
    (groups) => [amountAtom(valueOf(groups, FIGURE))],
    CHUNK_READING.mask,
  ),
  pattern(
    String.raw`(?<!\d)${figure(FIGURE, String.raw`\d+`)}(?!${COUNT_FOLLOWS})(?!${COUNT_ORDINAL})`,
    (groups) =>
      groups[FIGURE] === ARTICLE && groups[fractionOf(FIGURE)] === undefined
        ? []
        : [amountAtom(valueOf(groups, FIGURE))],
    CHUNK_READING.skip,
  ),
];
