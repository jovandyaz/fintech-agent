export const ID_PREFIXES = [
  'cus',
  'tx',
  'case',
  'run',
  'act',
  'chunk',
] as const;
export type IdPrefix = (typeof ID_PREFIXES)[number];

const MAX_ID_DIGITS = 4;
export const ID_PAYLOAD_PATTERN = String.raw`(?!(?:[a-z]*\d){${MAX_ID_DIGITS + 1}})[0-9a-z]+`;
const REGISTRY_ID = new RegExp(
  String.raw`^(?:${ID_PREFIXES.join('|')})_${ID_PAYLOAD_PATTERN}$`,
);

/** Whole-string pattern for a registry id with the given prefix, e.g. `tx_so02a`. */
export const registryIdPattern = (prefix: IdPrefix): RegExp =>
  new RegExp(String.raw`^${prefix}_${ID_PAYLOAD_PATTERN}$`);

const CROCKFORD_DIGITS = '0123456789';
const CROCKFORD_LETTERS = 'ABCDEFGHJKMNPQRSTVWXYZ';
const CROCKFORD = CROCKFORD_DIGITS + CROCKFORD_LETTERS;
const FOLIO_PREFIX = 'AC';
const FOLIO_GROUP_CHARS = 4;
const FOLIO_GROUPS = 2;
export const FOLIO_GROUP_PATTERN = String.raw`(?=\d{0,${FOLIO_GROUP_CHARS - 1}}[A-HJKMNP-TV-Z])[0-9A-HJKMNP-TV-Z]{${FOLIO_GROUP_CHARS}}`;
const FOLIO = new RegExp(
  `^${FOLIO_PREFIX}-${FOLIO_GROUP_PATTERN}-${FOLIO_GROUP_PATTERN}$`,
);

type RandomIndex = (size: number) => number;

const cryptoIndex: RandomIndex = (size) =>
  (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % size;

/** True when `value` is a system id: a registered prefix and a lowercase payload with at most 4 digits. */
export const isRegistryId = (value: string): boolean => REGISTRY_ID.test(value);

/** True when `value` is a folio `AC-XXXX-XXXX` with a letter in each group. */
export const isFolio = (value: string): boolean => FOLIO.test(value);

function newGroup(random: RandomIndex): string {
  const chars = Array.from(
    { length: FOLIO_GROUP_CHARS },
    () => CROCKFORD[random(CROCKFORD.length)] ?? CROCKFORD_LETTERS.charAt(0),
  );
  if (chars.every((c) => CROCKFORD_DIGITS.includes(c))) {
    chars[random(FOLIO_GROUP_CHARS)] = CROCKFORD_LETTERS.charAt(
      random(CROCKFORD_LETTERS.length),
    );
  }
  return chars.join('');
}

/**
 * A new case folio in Crockford base32. Each group holds at least one letter,
 * so no folio can carry 8 digits across its dash and the masker never touches it.
 */
export function newFolio(random: RandomIndex = cryptoIndex): string {
  const groups = Array.from({ length: FOLIO_GROUPS }, () => newGroup(random));
  return [FOLIO_PREFIX, ...groups].join('-');
}

const ID_LETTERS = 'abcdefghijkmnpqrstuvwxyz';
/** The prefix of a ticket id from the ticketing system (`tkt-…`). */
export const TICKET_ID_PREFIX = 'tkt-';
/** The prefix of a ticket event id (`evt-…`), as the ticketing system sends it. */
export const EVENT_ID_PREFIX = 'evt-';
const ID_PAYLOAD_CHARS = 12;

/** Random letters with no digit and no o or l, which the masker could read as digits. */
export function newIdPayload(random: RandomIndex = cryptoIndex): string {
  return Array.from(
    { length: ID_PAYLOAD_CHARS },
    () => ID_LETTERS[random(ID_LETTERS.length)] ?? ID_LETTERS.charAt(0),
  ).join('');
}

/**
 * A new system id, e.g. `case_kqmxtbwhpvra`; 24^12 values make a clash
 * negligible at this scale.
 */
export function newRegistryId(
  prefix: IdPrefix,
  random: RandomIndex = cryptoIndex,
): string {
  return `${prefix}_${newIdPayload(random)}`;
}
