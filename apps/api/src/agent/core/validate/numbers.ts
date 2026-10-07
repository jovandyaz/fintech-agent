import { REGISTRY_ID_IN_TEXT, visibleTailOf } from '@fintech-agent/contracts';

import { localDateOf, localTimeOf } from '../calendar.js';
import { ATOM_KIND, amountAtom, atom, dateForms } from './atoms.js';
import { CHUNK_READING, PATTERNS } from './number-patterns.js';
import { foldForMatching } from './spanish.js';

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T/;
const AMOUNT_KEY = 'amount';
const INSTANT_KEY_SUFFIX = '_at';
const LAST_DIGITS_KEY_SUFFIX = 'last4';
const CLABE_KEY_SUFFIX = 'clabe';
const ID_STAND_IN = 'id';
// ".5%", "$.50", ",5%": no leading zero. Never after a letter, digit, "%",
// dot or comma, so "20%,30%" keeps its 30 and "…50" its 50.
const LEADING_DECIMAL = /(?<![\p{L}\d%.,])[.,](\d{1,2})(?!\d)/gu;
// "$1.299,50", "1,5 mil", "3,5%": a comma before one or two final digits is
// decimal; before three it groups thousands.
const DECIMAL_COMMA = /\b(\d{1,3}(?:\.\d{3})+|\d+),(\d{1,2})\b/g;
const DOT = /\./g;

const READER = { draft: 'draft', chunk: 'chunk' } as const;
type Reader = (typeof READER)[keyof typeof READER];

const normalize = (text: string): string =>
  foldForMatching(text)
    .replace(REGISTRY_ID_IN_TEXT, ID_STAND_IN)
    .replace(LEADING_DECIMAL, '0.$1')
    .replace(
      DECIMAL_COMMA,
      (_, whole: string, fraction: string) =>
        `${whole.replace(DOT, '')}.${fraction}`,
    );

// See PATTERNS for why the order of readings decides who claims a figure. A
// masked match claims its span with no atoms, so it is kept but not returned.
function matchesOf(text: string, reader: Reader): string[][] {
  const normalized = normalize(text);
  const inChunk = reader === READER.chunk;
  const found: { start: number; end: number; forms: string[] }[] = [];
  for (const { regex, forms, chunk } of PATTERNS) {
    if (inChunk && chunk === CHUNK_READING.skip) continue;
    const masked = inChunk && chunk === CHUNK_READING.mask;
    for (const match of normalized.matchAll(regex)) {
      const matchForms = masked ? [] : forms(match.groups ?? {});
      if (matchForms.length === 0 && !masked) continue;
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
    if (forms.length > 0) kept.push(forms);
    consumedTo = end;
  }
  return kept;
}

/**
 * The amounts, percentages, durations, dates, years, times and last digits
 * a text states (02 G5 `UNGROUNDED_NUMBER`), in order, as comparable atoms,
 * whether written in digits or spelled out in Spanish. Any figure no other
 * reading claims is an amount; placeholders carry no digits, and a system
 * id, a count of a listed noun, an ordinal and the article 1 are not read.
 */
export function numberAtoms(text: string): string[] {
  return matchesOf(text, READER.draft).map(([exact]) => exact!);
}

function instantForms(value: string): string[] {
  if (!ISO_INSTANT.test(value) || Number.isNaN(Date.parse(value))) return [];
  const instant = new Date(value);
  const [year, month, day] = localDateOf(instant).split('-').map(Number);
  return [
    ...dateForms(String(year), month!, day!),
    atom(ATOM_KIND.time, localTimeOf(instant)),
  ];
}

// Never read an output as text: a merchant descriptor is set by a third
// party and could ground any figure, and `auth_factors` is a count.
function groundedForms(value: unknown, key = ''): string[] {
  if (key === AMOUNT_KEY && typeof value === 'number') {
    return [amountAtom(Math.abs(value))];
  }
  if (key.endsWith(INSTANT_KEY_SUFFIX) && typeof value === 'string') {
    return instantForms(value);
  }
  if (key.endsWith(LAST_DIGITS_KEY_SUFFIX) && typeof value === 'string') {
    return [atom(ATOM_KIND.last4, value.toLowerCase())];
  }
  if (key.endsWith(CLABE_KEY_SUFFIX) && typeof value === 'string') {
    const tail = visibleTailOf(value);
    return tail ? [atom(ATOM_KIND.last4, tail)] : [];
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
 * Every atom the run can ground a reply number on: the `amount`, the `*_at`
 * instants (as Mexico City dates, years and `hh:mm`), the `*last4` fields
 * and masked `*clabe` tails of the tool outputs it received, and what the
 * chunks it cited state with an explicit kind. Customer text is never
 * passed in.
 */
export function groundingAtoms(sources: {
  outputs: readonly unknown[];
  citedTexts: readonly string[];
}): ReadonlySet<string> {
  return new Set([
    ...sources.outputs.flatMap((output) => groundedForms(output)),
    ...sources.citedTexts.flatMap((text) =>
      matchesOf(text, READER.chunk).flat(),
    ),
  ]);
}

/** The atoms of `text` that nothing in `grounding` supports. */
export function ungroundedAtoms(
  text: string,
  grounding: ReadonlySet<string>,
): string[] {
  return numberAtoms(text).filter((atom) => !grounding.has(atom));
}
