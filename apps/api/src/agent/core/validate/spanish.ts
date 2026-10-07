import { foldNumberWords } from './number-words.js';

const IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;
const DIACRITICS = /\p{M}/gu;
const WHITESPACE = /\s+/g;

/** Month names in calendar order, as a reply writes them. */
export const SPANISH_MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

const UNIT_SPELLINGS = {
  minuto: ['minuto', 'minutos'],
  hora: ['hora', 'horas', 'hr', 'hrs', 'h', 'hs'],
  dia: ['dia', 'dias'],
  semana: ['semana', 'semanas'],
  mes: ['mes', 'meses'],
  ano: ['ano', 'anos'],
} as const;
const QUALIFIER_SPELLINGS = {
  habil: ['habiles', 'habil', 'bancarios', 'bancario'],
  natural: ['naturales', 'natural'],
} as const;

const canonicalOf = (
  spellings: Readonly<Record<string, readonly string[]>>,
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(spellings).flatMap(([canonical, forms]) =>
      forms.map((form) => [form, canonical]),
    ),
  );

/** Each spelling of a duration unit, folded, mapped to its canonical unit. */
export const UNITS = canonicalOf(UNIT_SPELLINGS);
/** Each spelling of a day-count qualifier, mapped to `habil` or `natural`. */
export const QUALIFIERS = canonicalOf(QUALIFIER_SPELLINGS);

/** A regex alternation of the keys of a spelling map. */
export const alternation = (forms: Readonly<Record<string, unknown>>): string =>
  Object.keys(forms).join('|');

/**
 * The one folding every lexical G5 check reads through, so they cannot
 * drift: accents, invisible characters and case removed, any run of
 * whitespace one space, and Spanish number words as digits.
 */
export const foldForMatching = (text: string): string =>
  foldNumberWords(
    text
      .normalize('NFKD')
      .replace(DIACRITICS, '')
      .replace(IGNORABLE, '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(WHITESPACE, ' '),
  );
