import {
  FOLIO_GROUP_PATTERN,
  ID_PAYLOAD_PATTERN,
  ID_PREFIXES,
  isRegistryId,
} from './ids.js';

const MASK = '••••';
const BULLET = '•';
const FACTOR = '[factor]';
const SHADOW = 'X';
const VISIBLE_DIGITS = 4;
const DECIMAL_BASE = 10;
const MAX_DECIMAL_DIGIT = 9;

const CLABE_DIGITS = 18;
const CLABE_WEIGHTS = [3, 7, 1] as const;
const CLABE_MIN_INNER_GROUP_DIGITS = 3;
const CARD_MIN_DIGITS = 13;
const CARD_MAX_DIGITS = 19;
const CARD_GROUPINGS = new Set(['4,4,4,4', '4,6,5', '4,4,4,4,3']);
const PHONE_DIGITS = 10;
const PHONE_GROUPINGS = new Set(['10', '2,4,4', '3,3,4', '2,8']);
const MX_COUNTRY_CODE = '52';
const MX_MOBILE_PREFIX = '1';
const MX_PHONE_PREFIXES = [MX_COUNTRY_CODE + MX_MOBILE_PREFIX, MX_COUNTRY_CODE];
const MAX_WINDOW_GROUPS = 8;

const MESSAGE_DIGIT_BUDGET = 8;
const MIN_DIGITS_FOR_TAIL = CARD_MIN_DIGITS;
const MAX_ND_BLOCK_SPAN = 60;
const ASCII_ZERO = 0x30;
const ASCII_NINE = 0x39;
const MAX_JSON_DEPTH = 64;
const EPOCH_MS_RANGE = { min: 1.5e12, max: 2.5e12 } as const;
const MAX_AMOUNT_VALUE = 1e7;

const JOINER = String.raw`[\s./_()+\-:]`;
const NOT_JOINED_AFTER = String.raw`(?!${JOINER}{1,3}\d)`;
const NOT_JOINED_BEFORE = String.raw`(?<!\d${JOINER}{1,3})`;

const MASK_LABELS = ['CLABE', 'tarjeta', 'tel', 'núm', 'ref'] as const;
const DOC_LABELS = ['CURP', 'RFC'] as const;
const LABEL = {
  clabe: 'CLABE',
  card: 'tarjeta',
  phone: 'tel',
  number: 'núm',
  ref: 'ref',
} as const;
type DigitKind = 'clabe' | 'card' | 'phone';

// Each exemption has a digit cap per message; past it, none of its matches is
// exempt, so exempt shapes cannot be stacked to carry a full value.
interface Exemption {
  pattern: RegExp;
  maxDigits: number;
  countPattern?: RegExp;
}

const OWN_MASK = new RegExp(
  String.raw`(?<=(?:${MASK_LABELS.join('|')}) )${MASK}[0-9A-Za-z+/=_-]{0,4}(?![0-9A-Za-z])|${BULLET}+(?!\d)|\[factor\]`,
  'gu',
);
const DATE = new RegExp(
  String.raw`(?<!\d)(?:(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?:[T ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:\.\d{1,6})?Z?)?|(?:0?[1-9]|[12]\d|3[01])\/(?:0?[1-9]|1[0-2])\/(?:19|20)\d{2}(?:[T ](?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?)?)(?!\d)`,
  'g',
);
const TIME = new RegExp(
  String.raw`${NOT_JOINED_BEFORE}(?<![\d:])(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?![\d:])${NOT_JOINED_AFTER}`,
  'g',
);
const AMOUNT_INT = String.raw`(?:\d{1,3}(?:,\d{3})?|\d{1,6})`;
const CURRENCY = String.raw`(?:MXN|mxn|pesos)`;
const AMOUNT_SHAPE = String.raw`(?<![\d.,])(?:\$\s?${AMOUNT_INT}(?:\.\d{2})?|${AMOUNT_INT}\.\d{2}(?:\s?${CURRENCY})?|${AMOUNT_INT}\s?${CURRENCY})(?!\d|[.,]\d)`;
const AMOUNT = new RegExp(
  `${NOT_JOINED_BEFORE}${AMOUNT_SHAPE}${NOT_JOINED_AFTER}`,
  'g',
);
const ANY_AMOUNT = new RegExp(AMOUNT_SHAPE, 'g');
const YEAR = new RegExp(
  String.raw`${NOT_JOINED_BEFORE}(?<!\d)(?:19|20)\d{2}(?!\d)${NOT_JOINED_AFTER}`,
  'g',
);
const POSTAL_CODE = /(?:\bCP|\bC\.P\.|c[oó]digo postal)\s*:?\s*\d{5}(?!\d)/gi;
const LAST_FOUR = new RegExp(
  String.raw`(?:termina(?:da)?\s+en|terminaci[oó]n|[uú]ltimos?\s+(?:4|cuatro)(?:\s+d[ií]gitos)?)\s*:?\s*\d{4}(?!\d)${NOT_JOINED_AFTER}`,
  'gi',
);
const REGISTRY_ID = new RegExp(
  String.raw`(?<![\p{L}\d_])(?:${ID_PREFIXES.join('|')})_${ID_PAYLOAD_PATTERN}(?![0-9a-z_])`,
  'gu',
);
const FOLIO = new RegExp(
  String.raw`(?<![\p{L}\d])AC-${FOLIO_GROUP_PATTERN}-${FOLIO_GROUP_PATTERN}(?![\p{L}\d])${NOT_JOINED_AFTER}`,
  'gu',
);
const UNCAPPED = Number.POSITIVE_INFINITY;
const DATE_DIGITS_CAP = 32;
const TIME_DIGITS_CAP = 24;
const AMOUNT_DIGITS_CAP = 16;
const LAST_FOUR_DIGITS_CAP = 8;
const POSTAL_DIGITS_CAP = 5;
const YEAR_DIGITS_CAP = 12;
const REGISTRY_DIGITS_CAP = 12;
const FOLIO_DIGITS_CAP = 12;
const EXEMPTIONS: readonly Exemption[] = [
  { pattern: OWN_MASK, maxDigits: UNCAPPED },
  { pattern: DATE, maxDigits: DATE_DIGITS_CAP },
  { pattern: TIME, maxDigits: TIME_DIGITS_CAP },
  { pattern: AMOUNT, maxDigits: AMOUNT_DIGITS_CAP, countPattern: ANY_AMOUNT },
  { pattern: LAST_FOUR, maxDigits: LAST_FOUR_DIGITS_CAP },
  { pattern: POSTAL_CODE, maxDigits: POSTAL_DIGITS_CAP },
  { pattern: YEAR, maxDigits: YEAR_DIGITS_CAP },
  { pattern: REGISTRY_ID, maxDigits: REGISTRY_DIGITS_CAP },
  { pattern: FOLIO, maxDigits: FOLIO_DIGITS_CAP },
];

const DIGIT_RUN = new RegExp(String.raw`[+(]?\d+(?:${JOINER}{1,3}\d+)*`, 'g');
const RUN_SPLIT = new RegExp(`(${JOINER}{1,3})`);
const DIGIT_GROUP = /\d+/g;
const LETTER_BEFORE = /\p{L}$/u;
const ECHO_LOOKBACK_CHARS = 40;
const SURROGATE_PAIR = 2;
const endsWithLetter = (text: string, at: number): boolean =>
  LETTER_BEFORE.test(text.slice(Math.max(0, at - SURROGATE_PAIR), at));
const WHITESPACE_ONLY = /^\s+$/;

const ND_DIGIT = /\p{Nd}/gu;
const IS_ND = /^\p{Nd}$/u;
const OTHER_NUMERIC = /[^\P{N}0-9]/gu;
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/gu;
const COMBINING = /\p{M}/gu;
const CONTROL = /[^\P{Cc}\t\n\r]/gu;
const CONFUSABLE_TOKEN =
  /(?<![\p{L}\d])(?=[oOlI]*\d)[0-9oOlI]{4,}(?![\p{L}\d])/gu;
const ZERO_LOOKALIKE = /[oO]/g;
const ONE_LOOKALIKE = /[lI]/g;
const CJK_DIGITS: Readonly<Record<string, string>> = {
  〇: '0',
  零: '0',
  一: '1',
  壹: '1',
  二: '2',
  贰: '2',
  貳: '2',
  三: '3',
  叁: '3',
  參: '3',
  四: '4',
  肆: '4',
  五: '5',
  伍: '5',
  六: '6',
  陆: '6',
  陸: '6',
  七: '7',
  柒: '7',
  八: '8',
  捌: '8',
  九: '9',
  玖: '9',
};
const CJK_DIGIT = new RegExp(`[${Object.keys(CJK_DIGITS).join('')}]`, 'gu');

const WORD_OR_DIGITS = /\p{L}+|\d+/gu;
const WORD_SEPARATOR = /^[^\p{L}\d]{1,3}$/u;
const Y_SEPARATOR = /^\s+y\s+$/i;
const Y_WORD = 'y';
const MIN_NUMBER_WORD_DIGITS = 8;
const UNIT_WORDS: Readonly<Record<string, number>> = {
  cero: 0,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
};
const TEEN_WORDS: Readonly<Record<string, number>> = {
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  dieciséis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veintiuno: 21,
  veintiun: 21,
  veintiún: 21,
  veintidos: 22,
  veintidós: 22,
  veintitres: 23,
  veintitrés: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintiséis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
  cien: 100,
};
const TENS_WORDS: Readonly<Record<string, number>> = {
  veinte: 20,
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
};
const COMPOUND_UNITS: Readonly<Record<string, number>> = {
  ...UNIT_WORDS,
  un: 1,
};
const REPEATERS: Readonly<Record<string, number>> = { doble: 2, triple: 3 };
const COMPOUND_TOKENS = 3;
const REPEATER_TOKENS = 2;

const CURP_SEP = String.raw`[\s.-]{0,3}`;
const CURP = new RegExp(
  String.raw`[A-Z]{4}${CURP_SEP}\d{6}${CURP_SEP}[HM]${CURP_SEP}[A-Z]{5}${CURP_SEP}[A-Z\d]${CURP_SEP}\d(?!\d)`,
  'giu',
);
const RFC_COMPACT = /(?<!\d)[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}(?!\d)/giu;
const RFC_SPACED =
  /(?<![\p{L}\d])[A-ZÑ&]{3,4}[\s.-]{1,3}\d{6}[\s.-]{0,3}[A-Z\d]{3}(?!\d)/gu;

const NUMBER_WORD = String.raw`(?:cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)`;
const AUTH_KEYWORD = String.raw`(?:cvv2?|cvc2?|nip|pin|otp|token|sms|code|c[oó]digo|contrase[ñn]a|clave|password|passcode)(?!\p{L})`;
const AUTH_GAP = String.raw`(?:[^\d•\[\]]{0,40}?[^\p{L}\d•\[\]])??`;
const AUTH_VALUE = String.raw`(?:\d(?:[ .,-]\d){2,7}|\d{2,4}[ -]\d{2,4}|\d{3,8}|${NUMBER_WORD}(?:[\s,]+${NUMBER_WORD}){2,7})(?![\d\p{L}]|[.,:/-]\d)`;
const AUTH_FACTOR_AFTER = new RegExp(
  String.raw`(?<!\p{L})(${AUTH_KEYWORD})(${AUTH_GAP})${AUTH_VALUE}`,
  'giu',
);
const AUTH_FACTOR_BEFORE = new RegExp(
  String.raw`(?<![\d•])\d(?:[ -]?\d){2,7}(\s+(?:es|era|fue)\s+(?:(?:mi|el|la|tu)\s+)?${AUTH_KEYWORD})`,
  'giu',
);
const NOT_AN_AUTH_FACTOR =
  /postal|rastreo|referencia|folio|interbancaria|error/i;

const EMAIL_LOCAL = String.raw`(?<![\p{L}\p{N}._%+-])([\p{L}\p{N}])[\p{L}\p{N}._%+-]*`;
const EMAIL_AT = new RegExp(
  String.raw`${EMAIL_LOCAL}(\s*@\s*)(\[[^\]\s]+\]|[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*)`,
  'gu',
);
const EMAIL_WORDS = new RegExp(
  String.raw`${EMAIL_LOCAL}(\s+(?:arroba|at)\s+)([\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+)`,
  'gu',
);

const OPAQUE_MIN_CHARS = 20;
const BASE64_MIN_CHARS = 12;
const OPAQUE_TOKEN = new RegExp(
  `(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/=_-]{${BASE64_MIN_CHARS},}(?![A-Za-z0-9+/=_-])`,
  'g',
);
const HAS_DIGIT = /\d/;
const HAS_LETTER = /[A-Za-z]/;
const PRINTABLE_TEXT = /^[\x20-\x7E\t\n\r]*$/;

const ECHO_LABEL = new RegExp(
  `(${[...MASK_LABELS, ...DOC_LABELS].join('|')}) ${BULLET}`,
  'gu',
);
const TRAILING_WORD = /(\p{L}+)[\s:]*$/u;

const CAMEL_BOUNDARY = /([a-z\d])([A-Z])/g;
const AUTH_FACTOR_KEY =
  /(?:^|_)(?:otp|nip|pin|cvv2?|cvc2?|password|passcode|token|secret|c[oó]digo)(?:_|$)|(?:^|_)(?:auth|security|verification|sms)_code(?:_|$)/;
const ID_KEY = /^(?:id|.+_id)$/;
const UUID =
  /^(?=.*[a-f])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_KEY = /(?:^|_)(?:at|ms|timestamp)$/;
const AMOUNT_KEY = /(?:^|_)(?:amount|cents)$/;
const LONG_DIGIT_RUN = new RegExp(String.raw`\d{${MESSAGE_DIGIT_BUDGET}}`);
const CIRCULAR = '[circular]';
const TOO_DEEP = '[too deep]';
const BINARY = '[binary]';

function toAsciiDigit(digit: string): string {
  const codePoint = digit.codePointAt(0) ?? ASCII_ZERO;
  if (codePoint >= ASCII_ZERO && codePoint <= ASCII_NINE) return digit;
  let offset = 0;
  while (
    offset < MAX_ND_BLOCK_SPAN &&
    IS_ND.test(String.fromCodePoint(codePoint - offset - 1))
  ) {
    offset++;
  }
  return String(offset % DECIMAL_BASE);
}

interface Token {
  text: string;
  start: number;
  end: number;
}

interface NumberRead {
  digits: string;
  next: number;
  isWord: boolean;
}

function readNumber(
  tokens: Token[],
  j: number,
  text: string,
): NumberRead | null {
  const token = tokens[j];
  if (!token) return null;
  if (HAS_DIGIT.test(token.text)) {
    return { digits: token.text, next: j + 1, isWord: false };
  }
  const word = token.text.toLowerCase();
  const following = tokens[j + 1];
  const repeat = REPEATERS[word];
  if (repeat !== undefined && following) {
    const unit = UNIT_WORDS[following.text.toLowerCase()];
    if (unit !== undefined) {
      return {
        digits: String(unit).repeat(repeat),
        next: j + REPEATER_TOKENS,
        isWord: true,
      };
    }
  }
  const tens = TENS_WORDS[word];
  if (tens !== undefined) {
    const unitToken = tokens[j + 2];
    const isCompound =
      following !== undefined &&
      unitToken !== undefined &&
      following.text.toLowerCase() === Y_WORD &&
      WHITESPACE_ONLY.test(text.slice(token.end, following.start)) &&
      WHITESPACE_ONLY.test(text.slice(following.end, unitToken.start));
    const unit = isCompound
      ? COMPOUND_UNITS[unitToken.text.toLowerCase()]
      : undefined;
    if (unit !== undefined && unit > 0) {
      return {
        digits: String(tens + unit),
        next: j + COMPOUND_TOKENS,
        isWord: true,
      };
    }
    return { digits: String(tens), next: j + 1, isWord: true };
  }
  const value = UNIT_WORDS[word] ?? TEEN_WORDS[word];
  return value === undefined
    ? null
    : { digits: String(value), next: j + 1, isWord: true };
}

function foldNumberWords(text: string): string {
  const tokens: Token[] = [...text.matchAll(WORD_OR_DIGITS)].map((m) => ({
    text: m[0],
    start: m.index,
    end: m.index + m[0].length,
  }));
  const out: string[] = [];
  let cursor = 0;
  let i = 0;
  while (i < tokens.length) {
    let j = i;
    let digits = '';
    let hasWord = false;
    let lastEnd = -1;
    while (j < tokens.length) {
      const token = tokens[j];
      if (!token) break;
      if (lastEnd >= 0) {
        const gap = text.slice(lastEnd, token.start);
        if (!WORD_SEPARATOR.test(gap) && !Y_SEPARATOR.test(gap)) break;
      }
      if (token.text.toLowerCase() === Y_WORD && lastEnd >= 0) {
        j++;
        continue;
      }
      const read = readNumber(tokens, j, text);
      if (!read) break;
      digits += read.digits;
      hasWord ||= read.isWord;
      lastEnd = tokens[read.next - 1]?.end ?? token.end;
      j = read.next;
    }
    const first = tokens[i];
    if (first && j > i && hasWord && digits.length >= MIN_NUMBER_WORD_DIGITS) {
      out.push(text.slice(cursor, first.start), digits);
      cursor = lastEnd;
      i = j;
    } else {
      i = Math.max(j, i + 1);
    }
  }
  out.push(text.slice(cursor));
  return out.join('');
}

function fold(text: string): string {
  const normalized = text
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(COMBINING, '')
    .replace(CONTROL, '')
    .replace(CJK_DIGIT, (c) => CJK_DIGITS[c] ?? '0')
    .replace(ND_DIGIT, toAsciiDigit)
    .replace(OTHER_NUMERIC, '0')
    .replace(CONFUSABLE_TOKEN, (token) =>
      token.replace(ZERO_LOOKALIKE, '0').replace(ONE_LOOKALIKE, '1'),
    );
  return foldNumberWords(normalized);
}

function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > MAX_DECIMAL_DIGIT) digit -= MAX_DECIMAL_DIGIT;
    }
    sum += digit;
  }
  return sum % DECIMAL_BASE === 0;
}

function isValidClabe(digits: string): boolean {
  if (digits.length !== CLABE_DIGITS) return false;
  let sum = 0;
  for (let i = 0; i < CLABE_DIGITS - 1; i++) {
    const weight = CLABE_WEIGHTS[i % CLABE_WEIGHTS.length] ?? 1;
    sum += (Number(digits[i]) * weight) % DECIMAL_BASE;
  }
  const control = (DECIMAL_BASE - (sum % DECIMAL_BASE)) % DECIMAL_BASE;
  return control === Number(digits[CLABE_DIGITS - 1]);
}

const isCard = (digits: string): boolean =>
  digits.length >= CARD_MIN_DIGITS &&
  digits.length <= CARD_MAX_DIGITS &&
  passesLuhn(digits);

const lengths = (groups: string[]): string =>
  groups.map((g) => g.length).join(',');

const isClabeGrouping = (groups: string[]): boolean =>
  groups.slice(0, -1).every((g) => g.length >= CLABE_MIN_INNER_GROUP_DIGITS);

function isGroupedPhone(groups: string[]): boolean {
  let rest = groups;
  if (rest.length > 1 && rest[0] === MX_COUNTRY_CODE) rest = rest.slice(1);
  if (rest.length > 1 && rest[0] === MX_MOBILE_PREFIX) rest = rest.slice(1);
  return (
    rest.join('').length === PHONE_DIGITS && PHONE_GROUPINGS.has(lengths(rest))
  );
}

const isContiguousPhone = (digits: string): boolean =>
  digits.length === PHONE_DIGITS ||
  MX_PHONE_PREFIXES.some(
    (prefix) =>
      digits.startsWith(prefix) &&
      digits.length === prefix.length + PHONE_DIGITS,
  );

function classifyWhole(digits: string): DigitKind | null {
  if (isValidClabe(digits)) return 'clabe';
  if (isContiguousPhone(digits)) return 'phone';
  return isCard(digits) ? 'card' : null;
}

function classifyWindow(groups: string[]): DigitKind | null {
  const digits = groups.join('');
  const contiguous = groups.length === 1;
  if (isValidClabe(digits) && isClabeGrouping(groups)) return 'clabe';
  if (contiguous ? isCard(digits) : CARD_GROUPINGS.has(lengths(groups))) {
    if (passesLuhn(digits)) return 'card';
  }
  const phone = contiguous ? isContiguousPhone(digits) : isGroupedPhone(groups);
  return phone ? 'phone' : null;
}

const render = (label: string, digits: string): string =>
  `${label} ${MASK}${digits.slice(-VISIBLE_DIGITS)}`;

// A number with no known shape shows its last 4 only when long enough that
// the tail cannot be half of a value split in two.
const renderNumber = (digits: string): string =>
  digits.length >= MIN_DIGITS_FOR_TAIL
    ? render(LABEL.number, digits)
    : `${LABEL.number} ${MASK}`;

function maskRun(run: string): string {
  const prefix = /^[+(]/.test(run) ? run.charAt(0) : '';
  const parts = run.slice(prefix.length).split(RUN_SPLIT);
  const groups = parts.filter((_, i) => i % 2 === 0);
  const separators = parts.filter((_, i) => i % 2 === 1);
  const digits = groups.join('');

  const whole = classifyWhole(digits);
  if (whole) return render(LABEL[whole], digits);

  const out: string[] = [];
  let labeled = false;
  let i = 0;
  while (i < groups.length) {
    const lead = i === 0 ? prefix : (separators[i - 1] ?? '');
    let kind: DigitKind | null = null;
    let matchedEnd = i;
    let count = 0;
    for (
      let end = i + 1;
      end <= groups.length && end - i <= MAX_WINDOW_GROUPS;
      end++
    ) {
      count += groups[end - 1]?.length ?? 0;
      if (count > CARD_MAX_DIGITS) break;
      const windowKind = classifyWindow(groups.slice(i, end));
      if (windowKind) {
        kind = windowKind;
        matchedEnd = end;
      }
    }
    if (kind) {
      labeled = true;
      out.push(
        i === 0 ? '' : lead,
        render(LABEL[kind], groups.slice(i, matchedEnd).join('')),
      );
      i = matchedEnd;
    } else {
      out.push(lead, BULLET.repeat(groups[i]?.length ?? 0));
      i++;
    }
  }
  return labeled ? out.join('') : renderNumber(digits);
}

const digitCount = (text: string): number =>
  text.match(DIGIT_GROUP)?.join('').length ?? 0;

function shadowOf(text: string): string {
  let shadow = text;
  for (const { pattern, maxDigits, countPattern } of EXEMPTIONS) {
    const matches = shadow.match(countPattern ?? pattern) ?? [];
    const total = matches.reduce((sum, m) => sum + digitCount(m), 0);
    if (total > maxDigits) continue;
    shadow = shadow.replace(pattern, (match) => SHADOW.repeat(match.length));
  }
  return shadow;
}

function maskDigitRuns(text: string): string {
  const shadow = shadowOf(text);
  const out: string[] = [];
  let cursor = 0;
  for (const match of shadow.matchAll(DIGIT_RUN)) {
    if (digitCount(match[0]) < MESSAGE_DIGIT_BUDGET) continue;
    const start = match.index;
    const glued = endsWithLetter(text, start);
    out.push(text.slice(cursor, start), glued ? ' ' : '', maskRun(match[0]));
    cursor = start + match[0].length;
  }
  out.push(text.slice(cursor));
  return out.join('');
}

function decodesToMaskable(token: string): boolean {
  let decoded: string;
  try {
    decoded = atob(token.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return false;
  }
  if (!PRINTABLE_TEXT.test(decoded)) return false;
  const folded = fold(decoded);
  if (digitCount(folded) >= MESSAGE_DIGIT_BUDGET) return true;
  return maskSegment(folded) !== folded;
}

function maskOpaqueTokens(text: string): string {
  return text.replace(OPAQUE_TOKEN, (token) => {
    const mixed =
      token.length >= OPAQUE_MIN_CHARS &&
      HAS_DIGIT.test(token) &&
      HAS_LETTER.test(token);
    return mixed || decodesToMaskable(token)
      ? `${LABEL.ref} ${MASK}${token.slice(-VISIBLE_DIGITS)}`
      : token;
  });
}

function enforceBudget(text: string): string {
  const shadow = shadowOf(text);
  if (digitCount(shadow) < MESSAGE_DIGIT_BUDGET) return text;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = shadow.charCodeAt(i);
    out += code >= ASCII_ZERO && code <= ASCII_NINE ? BULLET : text.charAt(i);
  }
  return out;
}

function absorbEchoes(text: string): string {
  const cuts: [number, number][] = [];
  for (const match of text.matchAll(ECHO_LABEL)) {
    const label = (match[1] ?? '').toLowerCase();
    let end = match.index;
    for (;;) {
      const window = text.slice(Math.max(0, end - ECHO_LOOKBACK_CHARS), end);
      const word = TRAILING_WORD.exec(window);
      if (!word || word[1]?.toLowerCase() !== label) break;
      const start = end - word[0].length;
      if (endsWithLetter(text, start)) break;
      cuts.push([start, end]);
      end = start;
    }
  }
  if (cuts.length === 0) return text;
  cuts.sort((a, b) => a[0] - b[0]);
  const out: string[] = [];
  let cursor = 0;
  for (const [start, end] of cuts) {
    out.push(text.slice(cursor, start));
    cursor = end;
  }
  out.push(text.slice(cursor));
  return out.join('');
}

const maskEmail = (
  _: string,
  first: string,
  at: string,
  domain: string,
): string => `${first}•••${at}${domain}`;

function maskSegment(text: string): string {
  const patterned = text
    .replace(CURP, `CURP ${MASK}`)
    .replace(RFC_COMPACT, `RFC ${MASK}`)
    .replace(RFC_SPACED, `RFC ${MASK}`)
    .replace(AUTH_FACTOR_AFTER, (match, keyword: string, gap: string) =>
      NOT_AN_AUTH_FACTOR.test(gap) ? match : `${keyword}${gap}${FACTOR}`,
    )
    .replace(AUTH_FACTOR_BEFORE, (_, rest: string) => `${FACTOR}${rest}`)
    .replace(EMAIL_AT, maskEmail)
    .replace(EMAIL_WORDS, maskEmail);
  return absorbEchoes(
    enforceBudget(maskOpaqueTokens(maskDigitRuns(patterned))),
  );
}

/**
 * Masks personal data in free text, fail-closed on numbers: CLABE, card and
 * phone numbers get a label; a message still holding 8 or more digits outside
 * dates, times, amounts, last-4 phrases, postal codes, years, registry ids and
 * folios (each capped per message) has every other digit masked. Folds
 * look-alike digits, invisible characters and number words first.
 * Idempotent and linear in the input length.
 */
export function maskPii(text: string): string {
  return maskSegment(fold(text));
}

const snakeKey = (key: string): string =>
  key.replace(CAMEL_BOUNDARY, '$1_$2').toLowerCase();

function maskNumber(value: number, key: string): number | string {
  const plausibleEpoch =
    value > EPOCH_MS_RANGE.min && value < EPOCH_MS_RANGE.max;
  if (TIME_KEY.test(key) && plausibleEpoch) return value;
  if (AMOUNT_KEY.test(key) && Math.abs(value) < MAX_AMOUNT_VALUE) return value;
  const text = String(value);
  return LONG_DIGIT_RUN.test(text) ? maskPii(text) : value;
}

function maskValue(
  value: unknown,
  key: string,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null || value === undefined) return value;
  if (AUTH_FACTOR_KEY.test(key)) return FACTOR;
  if (typeof value === 'string') {
    const keep = ID_KEY.test(key) && (UUID.test(value) || isRegistryId(value));
    return keep ? value : maskPii(value);
  }
  if (typeof value === 'number') return maskNumber(value, key);
  if (typeof value === 'bigint') return maskPii(value.toString());
  if (typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return BINARY;
  if (depth >= MAX_JSON_DEPTH) return TOO_DEEP;
  if (seen.has(value)) return CIRCULAR;
  seen.add(value);
  const result = Array.isArray(value)
    ? value.map((item: unknown) => maskValue(item, key, depth + 1, seen))
    : Object.fromEntries(
        Object.entries(value).map(([k, v]) => [
          maskPii(k),
          maskValue(v, snakeKey(k), depth + 1, seen),
        ]),
      );
  seen.delete(value);
  return result;
}

/**
 * Masks parsed JSON-like data value by value, so escaped characters in
 * serialized text cannot split a value. Any value under an auth-factor key is
 * replaced whole; registry and UUID ids under id keys are kept; a long number
 * is kept only as a plausible epoch-ms timestamp under a time key or an amount
 * under an amount key. Keys are masked too. Circular, very deep and binary
 * data become markers instead of throwing.
 */
export function maskJson(value: unknown): unknown {
  return maskValue(value, '', 0, new WeakSet());
}
