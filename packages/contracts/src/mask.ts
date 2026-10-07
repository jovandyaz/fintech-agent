import {
  FOLIO_GROUP_PATTERN,
  ID_PAYLOAD_PATTERN,
  ID_PREFIXES,
  isFolio,
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
const SIGNIFICANT_DIGITS = 6;
const CENTS = 100;
const FLOAT_TOLERANCE = 1e-9;

const NON_DIGIT = /\D/g;
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
// exempt, so one exempt shape cannot be repeated to carry a full value.
interface Exemption {
  pattern: RegExp;
  maxDigits: number;
  countPattern?: RegExp;
  accepts?: (matches: string[]) => boolean;
}

const OWN_MASK = new RegExp(
  String.raw`(?<=(?:${MASK_LABELS.join('|')}) )${MASK}[0-9A-Za-z+/_-]{0,4}(?![0-9A-Za-z])|${BULLET}+(?!\d)|\[factor\]`,
  'gu',
);
const DATE = new RegExp(
  String.raw`(?<!\d)(?:(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?:[T ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:\.\d{1,6})?Z?)?|(?:0?[1-9]|[12]\d|3[01])\/(?:0?[1-9]|1[0-2])\/(?:19|20)\d{2}(?:[T ](?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?)?)(?!\d)`,
  'g',
);
const TIME_CORE = String.raw`(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?`;
const TIMES = new RegExp(
  String.raw`${NOT_JOINED_BEFORE}(?<![\d:])${TIME_CORE}(?:(?:\s*(?:,|-|\by\b|\ba\b)\s*|\s+)${TIME_CORE})*(?![\d:])${NOT_JOINED_AFTER}`,
  'g',
);
const AMOUNT_INT = String.raw`(?:\d{1,3}(?:,\d{3})?|\d,\d{3},\d{3}|\d{1,7})`;
const CURRENCY = String.raw`(?:MXN|mxn|pesos)`;
const AMOUNT_SHAPE = String.raw`(?<![\d.,])(?:\$\s?${AMOUNT_INT}(?:\.\d{2})?|${AMOUNT_INT}\.\d{2}(?:\s?${CURRENCY})?|${AMOUNT_INT}\s?${CURRENCY})(?!\d|[.,]\d)`;
const AMOUNT = new RegExp(
  `${NOT_JOINED_BEFORE}${AMOUNT_SHAPE}${NOT_JOINED_AFTER}`,
  'g',
);
const ANY_AMOUNT = new RegExp(AMOUNT_SHAPE, 'g');
const LARGE_AMOUNT_INT_DIGITS = 6;
const MAX_LARGE_AMOUNTS = 1;
const AMOUNT_INTEGER = /^[^\d]*([\d,]+)/;
const integerDigits = (amount: string): number =>
  (AMOUNT_INTEGER.exec(amount)?.[1] ?? '').replace(NON_DIGIT, '').length;
const fewLargeAmounts = (matches: string[]): boolean =>
  matches.filter((m) => integerDigits(m) >= LARGE_AMOUNT_INT_DIGITS).length <=
  MAX_LARGE_AMOUNTS;
const PERCENT = /(?<![\d.,])\d{1,3}(?:[.,]\d{1,2})?\s?%/g;
const DURATION =
  /(?<![\d.,])\d{1,3}\s(?:d[ií]as?|mes(?:es)?|años?|horas?|minutos?|semanas?|segundos?|veces|MSI)(?!\p{L})/giu;
const REFERENCE =
  /(?<!\p{L})(?:ref(?:erencia)?|orden|pedido|folio|operaci[oó]n|contrato|ticket|caso)\.?(?:\s+(?:n[uú]m(?:ero)?\.?|no\.?))?\s*:?\s*#?\s*\d{1,7}(?:-\d{1,7})?(?![\d-])/giu;
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
const AMOUNT_DIGITS_CAP = 40;
const PERCENT_DIGITS_CAP = 12;
const DURATION_DIGITS_CAP = 12;
const REFERENCE_DIGITS_CAP = 16;
const LAST_FOUR_DIGITS_CAP = 8;
const POSTAL_DIGITS_CAP = 5;
const YEAR_DIGITS_CAP = 12;
const REGISTRY_DIGITS_CAP = 12;
const FOLIO_DIGITS_CAP = 12;
const EXEMPTIONS: readonly Exemption[] = [
  { pattern: OWN_MASK, maxDigits: UNCAPPED },
  { pattern: DATE, maxDigits: DATE_DIGITS_CAP },
  { pattern: TIMES, maxDigits: TIME_DIGITS_CAP },
  {
    pattern: AMOUNT,
    maxDigits: AMOUNT_DIGITS_CAP,
    countPattern: ANY_AMOUNT,
    accepts: fewLargeAmounts,
  },
  { pattern: PERCENT, maxDigits: PERCENT_DIGITS_CAP },
  { pattern: DURATION, maxDigits: DURATION_DIGITS_CAP },
  { pattern: REFERENCE, maxDigits: REFERENCE_DIGITS_CAP },
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
const WHITESPACE_ONLY = /^\s+$/;
const TENS_UNIT_GAP = /^[\s-]+$/;

const ND_DIGIT = /\p{Nd}/gu;
const IS_ND = /^\p{Nd}$/u;
const OTHER_NUMERIC = /[^\P{N}0-9]/gu;
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/gu;
const COMBINING = /\p{M}/gu;
const CONTROL = /[^\P{Cc}\t\n\r]/gu;
const ENCODED_AT = /%40|&#0*64;|&#x0*40;/gi;
const MIXED_SCRIPT_TOKEN = /[\p{L}\p{N}]+/gu;
const HAS_LATIN = /\p{Script=Latin}/u;
const HAS_LOOKALIKE_SCRIPT = /[\p{Script=Cyrillic}\p{Script=Greek}]/u;
const HOMOGLYPHS: Readonly<Record<string, string>> = {
  А: 'A',
  В: 'B',
  Е: 'E',
  К: 'K',
  М: 'M',
  Н: 'H',
  О: 'O',
  Р: 'P',
  С: 'C',
  Т: 'T',
  Х: 'X',
  У: 'Y',
  І: 'I',
  Ј: 'J',
  Ѕ: 'S',
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  у: 'y',
  х: 'x',
  і: 'i',
  ј: 'j',
  ѕ: 's',
  п: 'n',
  к: 'k',
  м: 'm',
  т: 't',
  н: 'h',
  Α: 'A',
  Β: 'B',
  Ε: 'E',
  Ζ: 'Z',
  Η: 'H',
  Ι: 'I',
  Κ: 'K',
  Μ: 'M',
  Ν: 'N',
  Ο: 'O',
  Ρ: 'P',
  Τ: 'T',
  Υ: 'Y',
  Χ: 'X',
  ο: 'o',
  ν: 'v',
  ι: 'i',
  ρ: 'p',
};
const HOMOGLYPH = new RegExp(`[${Object.keys(HOMOGLYPHS).join('')}]`, 'gu');
const CONFUSABLE_TOKEN =
  /(?<![\p{L}\d•])(?=[oOlI]*\d)[0-9oOlI]{4,}(?![\p{L}\d])/gu;
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
const MIN_FOLDED_DIGITS = 8;
const MIN_FOLDED_WORDS = 2;
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
  oh: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  zéro: 0,
  un: 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  sept: 7,
  huit: 8,
  neuf: 9,
  um: 1,
  dois: 2,
  três: 3,
  sete: 7,
  oito: 8,
  nove: 9,
  null: 0,
  eins: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fünf: 5,
  funf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
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
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
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
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const HUNDREDS_WORDS: Readonly<Record<string, number>> = {
  cien: 100,
  ciento: 100,
  doscientos: 200,
  trescientos: 300,
  cuatrocientos: 400,
  quinientos: 500,
  seiscientos: 600,
  setecientos: 700,
  ochocientos: 800,
  novecientos: 900,
};
const COMPOUND_UNITS: Readonly<Record<string, number>> = {
  ...UNIT_WORDS,
  un: 1,
};
const REPEATERS: Readonly<Record<string, number>> = { doble: 2, triple: 3 };
const COMPOUND_TOKENS = 3;
const PAIR_TOKENS = 2;

const LOOSE_SEP = String.raw`[\s./-]{0,3}`;
const looseChars = (classes: string[]): string => classes.join(LOOSE_SEP);
const repeatClass = (cls: string, count: number): string[] =>
  Array.from({ length: count }, () => cls);
const UPPER = '[A-ZÑ&]';
const CURP = new RegExp(
  String.raw`[A-Z]{4}[\s.-]{0,3}\d{6}[\s.-]{0,3}[HM][\s.-]{0,3}[A-Z]{5}[\s.-]{0,3}[A-Z\d][\s.-]{0,3}\d(?!\d)`,
  'giu',
);
const CURP_LOOSE = new RegExp(
  `(?<![\\p{L}\\d])${looseChars([
    ...repeatClass('[A-Z]', 4),
    ...repeatClass('\\d', 6),
    '[HM]',
    ...repeatClass('[A-Z]', 5),
    '[A-Z\\d]',
    '\\d',
  ])}(?!\\d)`,
  'gu',
);
const RFC_COMPACT = /(?<!\d)[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}(?!\d)/giu;
const RFC_LOOSE = new RegExp(
  `(?<![\\p{L}\\d])${looseChars([...repeatClass(UPPER, 3)])}(?:${LOOSE_SEP}${UPPER})?${LOOSE_SEP}${looseChars(
    [...repeatClass('\\d', 6), ...repeatClass('[A-Z\\d]', 3)],
  )}(?![\\p{L}\\d])`,
  'gu',
);

const DOTTED = (letters: string): string =>
  [...letters].join(String.raw`\.?\s?`) + String.raw`\.?`;
const AUTH_KEYWORD = String.raw`(?:${DOTTED('nip')}|${DOTTED('pin')}|${DOTTED('cvv')}2?|${DOTTED('cvc')}2?|${DOTTED('otp')}|totp|mfa|2fa|token|sms|code|c[oó]digo|contrase[ñn]a|clave|password|passcode|pwd|pass|secret[oa]?|d[ií]gitos de atr[aá]s)(?!\p{L})`;
const AUTH_GAP = String.raw`(?:[^\d•\]]{0,40}?[^\p{L}\d•\]])??`;
const NOT_AN_AMOUNT_OR_DATE = String.raw`(?!\d{3,7}[.,]\d{2}(?!\d)|\d{1,2}[:/]\d{1,2}|(?:19|20)\d{2}-)`;
const AUTH_DIGITS = String.raw`${NOT_AN_AMOUNT_OR_DATE}(?:\d(?:[ .,_-]?\d){2,15}|\d{1,4}(?:[ .,_-]\d{1,4}){1,3})(?![\d\p{L}]|[.,:/-]\d)`;
const AUTH_FACTOR_AFTER = new RegExp(
  String.raw`(?<!\p{L})(${AUTH_KEYWORD})(${AUTH_GAP})${AUTH_DIGITS}`,
  'giu',
);
const AUTH_FACTOR_BEFORE = new RegExp(
  String.raw`(?<![\d•])${AUTH_DIGITS}(\s*,?\s*(?:(?:es|era|fue|is|was)\s+)?(?:(?:mi|el|la|tu|my|the)\s+)?${AUTH_KEYWORD})`,
  'giu',
);
const SECRET_AFTER =
  /(?<!\p{L})(password|passcode|contrase[ñn]a|clave de acceso|pwd|pass)(\s*(?:es|is|:|=)?\s*)(\S{4,64})/giu;
const STRONG_SECRET = /[\d\p{P}\p{S}]|\p{Lu}.*\p{Ll}|\p{Ll}.*\p{Lu}/u;
const NOT_AN_AUTH_FACTOR =
  /postal|rastreo|referencia|folio|interbancaria|error/i;

const EMAIL_LOCAL_PART =
  /(?<![\p{L}\p{N}._%+-])([\p{L}\p{N}])[\p{L}\p{N}._%+-]*(?=\s*@)/gu;
const EMAIL_WORDS = new RegExp(
  String.raw`(?<![\p{L}\p{N}._%+-])([\p{L}\p{N}])[\p{L}\p{N}._%+-]*(\s*[\[(]?\s*(?:at|arroba)\s*[\])]?\s*)([\p{L}\p{N}-]+(?:(?:\.|\s+(?:dot|punto)\s+)[\p{L}\p{N}-]+)+)`,
  'giu',
);

const OPAQUE_MIN_CHARS = 20;
const BASE64_MIN_CHARS = 12;
const OPAQUE_TOKEN = new RegExp(
  `(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/=_-]{${BASE64_MIN_CHARS},}(?![A-Za-z0-9+/=_-])`,
  'g',
);
const INNER_PADDING = /=+(?=[A-Za-z0-9+/_-])/;
const TRAILING_PADDING = /=+$/;
const HAS_DIGIT = /\d/;
const HAS_LETTER = /[A-Za-z]/;
const NON_PRINTABLE = /[^\x20-\x7E\t\n\r]/g;
const MIN_PRINTABLE_SHARE = 0.75;

const ECHO_LABEL = new RegExp(
  `(${[...MASK_LABELS, ...DOC_LABELS].join('|')}) ${BULLET}`,
  'gu',
);
const TRAILING_WORD = /(\p{L}+)[\s:]*$/u;

const CAMEL_BOUNDARY = /([a-z\d])([A-Z])/g;
const NON_ALNUM = /[^a-z0-9ñ]+/g;
const AUTH_FACTOR_KEY =
  /(?:^|_)(?:otp|totp|nip|pins?|cvv2?|cvc2?|password|passwd|pass|pwd|passcode|token|secret|secreto|clave|contrasena|contraseña|codigo|2fa|mfa)(?:_|$)|(?:^|_)(?:auth|security|verification|sms|mfa|pin)_code(?:_|$)/;
const PAIR_NAME_KEYS = ['name', 'key', 'field', 'type'] as const;
const PAIR_VALUE_KEY = 'value';
const ID_KEY = /^(?:id|.+_id)$/;
const MIN_UUID_HEX_LETTERS = 4;
const UUID = new RegExp(
  `^(?=(?:[^a-f]*[a-f]){${MIN_UUID_HEX_LETTERS}})[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
  'i',
);
const TIME_KEY = /(?:^|_)(?:at|ms|timestamp)$/;
const AMOUNT_KEY = /(?:^|_)(?:amount|cents)$/;
const MARKER = {
  circular: '[circular]',
  tooDeep: '[too deep]',
  binary: '[binary]',
  unreadable: '[unreadable]',
} as const;

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

const lower = (token: Token | undefined): string =>
  token?.text.toLowerCase() ?? '';

const gapBetween = (text: string, a: Token, b: Token): string =>
  text.slice(a.end, b.start);

function readTwoDigits(
  tokens: Token[],
  j: number,
  text: string,
): NumberRead | null {
  const token = tokens[j];
  if (!token) return null;
  const word = lower(token);
  const tens = TENS_WORDS[word];
  if (tens !== undefined) {
    const following = tokens[j + 1];
    const afterY = tokens[j + 2];
    if (
      following &&
      afterY &&
      lower(following) === Y_WORD &&
      WHITESPACE_ONLY.test(gapBetween(text, token, following)) &&
      WHITESPACE_ONLY.test(gapBetween(text, following, afterY))
    ) {
      const unit = COMPOUND_UNITS[lower(afterY)];
      if (unit !== undefined && unit > 0) {
        return {
          digits: String(tens + unit),
          next: j + COMPOUND_TOKENS,
          isWord: true,
        };
      }
    }
    if (following && TENS_UNIT_GAP.test(gapBetween(text, token, following))) {
      const unit = UNIT_WORDS[lower(following)];
      if (unit !== undefined && unit > 0) {
        return {
          digits: String(tens + unit),
          next: j + PAIR_TOKENS,
          isWord: true,
        };
      }
    }
    return { digits: String(tens), next: j + 1, isWord: true };
  }
  const value = UNIT_WORDS[word] ?? TEEN_WORDS[word];
  return value === undefined
    ? null
    : { digits: String(value), next: j + 1, isWord: true };
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
  const word = lower(token);
  const following = tokens[j + 1];
  const repeat = REPEATERS[word];
  if (repeat !== undefined && following) {
    const unit = UNIT_WORDS[lower(following)];
    if (unit !== undefined) {
      return {
        digits: String(unit).repeat(repeat),
        next: j + PAIR_TOKENS,
        isWord: true,
      };
    }
  }
  const hundreds = HUNDREDS_WORDS[word];
  if (hundreds !== undefined) {
    const rest =
      following && WHITESPACE_ONLY.test(gapBetween(text, token, following))
        ? readTwoDigits(tokens, j + 1, text)
        : null;
    return rest
      ? {
          digits: String(hundreds + Number(rest.digits)),
          next: rest.next,
          isWord: true,
        }
      : { digits: String(hundreds), next: j + 1, isWord: true };
  }
  return readTwoDigits(tokens, j, text);
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
    let wordTokens = 0;
    let lastEnd = -1;
    while (j < tokens.length) {
      const token = tokens[j];
      if (!token) break;
      if (lastEnd >= 0) {
        const gap = text.slice(lastEnd, token.start);
        if (!WORD_SEPARATOR.test(gap) && !Y_SEPARATOR.test(gap)) {
          if (!(lower(token) === Y_WORD && WHITESPACE_ONLY.test(gap))) break;
        }
        if (lower(token) === Y_WORD) {
          j++;
          continue;
        }
      }
      const read = readNumber(tokens, j, text);
      if (!read) break;
      digits += read.digits;
      if (read.isWord) wordTokens += read.next - j;
      lastEnd = tokens[read.next - 1]?.end ?? token.end;
      j = read.next;
    }
    const first = tokens[i];
    const folds =
      wordTokens > 0 &&
      (wordTokens >= MIN_FOLDED_WORDS || digits.length >= MIN_FOLDED_DIGITS);
    if (first && j > i && folds) {
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

const foldMixedScript = (token: string): string =>
  HAS_LATIN.test(token) && HAS_LOOKALIKE_SCRIPT.test(token)
    ? token.replace(HOMOGLYPH, (c) => HOMOGLYPHS[c] ?? c)
    : token;

function fold(text: string): string {
  const normalized = text
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(COMBINING, '')
    .replace(CONTROL, '')
    .replace(ENCODED_AT, '@')
    .replace(MIXED_SCRIPT_TOKEN, foldMixedScript)
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

const render = (label: string, tail: string): string =>
  `${label} ${MASK}${tail.slice(-VISIBLE_DIGITS)}`;

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

const endsWithLetter = (text: string, at: number): boolean =>
  LETTER_BEFORE.test(text.slice(Math.max(0, at - SURROGATE_PAIR), at));

function shadowOf(text: string): string {
  let shadow = text;
  for (const { pattern, maxDigits, countPattern, accepts } of EXEMPTIONS) {
    const matches = shadow.match(countPattern ?? pattern) ?? [];
    const total = matches.reduce((sum, m) => sum + digitCount(m), 0);
    if (total > maxDigits || (accepts && !accepts(matches))) continue;
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

function decodesToMaskable(piece: string): boolean {
  let decoded: string;
  try {
    decoded = atob(piece.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return false;
  }
  const unprintable = decoded.match(NON_PRINTABLE)?.length ?? 0;
  if (unprintable > decoded.length * (1 - MIN_PRINTABLE_SHARE)) return false;
  const printable = fold(decoded.replace(NON_PRINTABLE, ' '));
  if (digitCount(printable) >= MESSAGE_DIGIT_BUDGET) return true;
  return maskSegment(printable) !== printable;
}

function maskOpaqueTokens(text: string): string {
  return text.replace(OPAQUE_TOKEN, (token) => {
    if (isFolio(token) || isRegistryId(token)) return token;
    const mixed =
      token.length >= OPAQUE_MIN_CHARS &&
      HAS_DIGIT.test(token) &&
      HAS_LETTER.test(token);
    const encoded = token
      .split(INNER_PADDING)
      .some(
        (piece) => piece.length >= BASE64_MIN_CHARS && decodesToMaskable(piece),
      );
    return mixed || encoded
      ? render(LABEL.ref, token.replace(TRAILING_PADDING, ''))
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

const SENTENCE_PUNCTUATION = /^[.,;:!?)\]"'»]*$/u;
const MAX_PUNCTUATION_AFTER_FOLIO = 2;

type Replacer = (match: string, ...groups: string[]) => string;
type ValueSpan = (match: string, ...groups: string[]) => [number, number];

const valueAfter: ValueSpan = (match, keyword = '', gap = '') => [
  keyword.length + gap.length,
  match.length,
];
const valueBefore: ValueSpan = (match, rest = '') => [
  0,
  match.length - rest.length,
];

// A folio such as AC-PWDW-8NYN is a system id whose groups can spell a
// keyword. A value is spared only when it is a folio plus the sentence
// punctuation a greedy match swallows; anything else beside a folio is masked.
function replaceUnlessValueInFolio(
  text: string,
  pattern: RegExp,
  valueSpan: ValueSpan,
  replace: Replacer,
): string {
  const folios = [...text.matchAll(FOLIO)];
  if (folios.length === 0) return text.replace(pattern, replace);
  const inFolio = new Array<boolean>(text.length).fill(false);
  for (const folio of folios) {
    inFolio.fill(true, folio.index, folio.index + folio[0].length);
  }
  return text.replace(pattern, (match: string, ...rest: unknown[]) => {
    const at = rest.findIndex((arg) => typeof arg === 'number');
    const groups = rest.slice(0, at) as string[];
    const [from, to] = valueSpan(match, ...groups).map(
      (offset) => (rest[at] as number) + offset,
    ) as [number, number];
    let outside = '';
    let touchesFolio = false;
    for (let i = from; i < to; i++) {
      if (inFolio[i]) touchesFolio = true;
      else outside += text[i] ?? '';
    }
    const spared =
      touchesFolio &&
      outside.length <= MAX_PUNCTUATION_AFTER_FOLIO &&
      SENTENCE_PUNCTUATION.test(outside);
    return spared ? match : replace(match, ...groups);
  });
}

function maskSegment(text: string): string {
  const identified = text
    .replace(CURP, `CURP ${MASK}`)
    .replace(CURP_LOOSE, `CURP ${MASK}`)
    .replace(RFC_COMPACT, `RFC ${MASK}`)
    .replace(RFC_LOOSE, `RFC ${MASK}`);
  const withoutSecrets = replaceUnlessValueInFolio(
    identified,
    SECRET_AFTER,
    valueAfter,
    (match, keyword = '', gap = '', secret = '') =>
      secret === FACTOR || !STRONG_SECRET.test(secret)
        ? match
        : `${keyword}${gap}${FACTOR}`,
  );
  const withoutFactorsAfter = replaceUnlessValueInFolio(
    withoutSecrets,
    AUTH_FACTOR_AFTER,
    valueAfter,
    (match, keyword = '', gap = '') =>
      NOT_AN_AUTH_FACTOR.test(gap) ? match : `${keyword}${gap}${FACTOR}`,
  );
  const patterned = replaceUnlessValueInFolio(
    withoutFactorsAfter,
    AUTH_FACTOR_BEFORE,
    valueBefore,
    (_, rest = '') => `${FACTOR}${rest}`,
  )
    .replace(EMAIL_LOCAL_PART, (_, first: string) => `${first}•••`)
    .replace(
      EMAIL_WORDS,
      (_, first: string, at: string, domain: string) =>
        `${first}•••${at}${domain}`,
    );
  return absorbEchoes(
    enforceBudget(maskOpaqueTokens(maskDigitRuns(patterned))),
  );
}

/**
 * Masks personal data in free text, fail-closed on numbers: CLABE, card and
 * phone numbers get a label; a message still holding 8 or more digits outside
 * dates, times, amounts, percentages, durations, references, last-4 phrases,
 * postal codes, years, registry ids and folios (each capped per message) has
 * every other digit masked. Folds look-alike characters and number words in
 * several languages first. Idempotent and linear in the input length.
 */
export function maskPii(text: string): string {
  return maskSegment(fold(text));
}

const snakeKey = (key: string): string =>
  key.replace(CAMEL_BOUNDARY, '$1_$2').toLowerCase().replace(NON_ALNUM, '_');

const isFactorName = (name: unknown): boolean =>
  typeof name === 'string' && AUTH_FACTOR_KEY.test(snakeKey(name));

function hasAtMostCents(value: number): boolean {
  return Math.abs(value * CENTS - Math.round(value * CENTS)) < FLOAT_TOLERANCE;
}

function maskNumber(value: number, key: string): number | string {
  if (!Number.isFinite(value)) return value;
  const plausibleEpoch =
    value > EPOCH_MS_RANGE.min && value < EPOCH_MS_RANGE.max;
  if (TIME_KEY.test(key) && plausibleEpoch) return value;
  if (
    AMOUNT_KEY.test(key) &&
    Math.abs(value) < MAX_AMOUNT_VALUE &&
    hasAtMostCents(value)
  ) {
    return value;
  }
  if (!Number.isInteger(value)) {
    return Number(value.toPrecision(SIGNIFICANT_DIGITS));
  }
  const digits = String(value).replace(NON_DIGIT, '');
  return digits.length >= MESSAGE_DIGIT_BUDGET ? maskPii(String(value)) : value;
}

function unbox(value: object): unknown {
  if (
    value instanceof String ||
    value instanceof Number ||
    value instanceof Boolean
  ) {
    return value.valueOf();
  }
  return value;
}

function maskObject(
  value: object,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  const entries = Object.entries(value);
  const pairName = PAIR_NAME_KEYS.map(
    (k) => (value as Record<string, unknown>)[k],
  ).find(isFactorName);
  const result: Record<string, unknown> = {};
  for (const [key, child] of entries) {
    const masked =
      pairName !== undefined && key === PAIR_VALUE_KEY
        ? FACTOR
        : maskValue(child, snakeKey(key), depth + 1, seen);
    let name = maskPii(key);
    for (let n = 2; Object.hasOwn(result, name); n++) {
      name = `${maskPii(key)} (${n})`;
    }
    result[name] = masked;
  }
  return result;
}

function maskArray(
  value: unknown[],
  key: string,
  depth: number,
  seen: WeakSet<object>,
): unknown[] {
  const [first] = value;
  if (value.length === PAIR_TOKENS && isFactorName(first)) {
    return [first, FACTOR];
  }
  return value.map((item) => maskValue(item, key, depth + 1, seen));
}

function maskValue(
  raw: unknown,
  key: string,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  const value = typeof raw === 'object' && raw !== null ? unbox(raw) : raw;
  if (value === null || value === undefined) return value;
  if (AUTH_FACTOR_KEY.test(key)) return FACTOR;
  if (typeof value === 'string') {
    const keep = ID_KEY.test(key) && (UUID.test(value) || isRegistryId(value));
    return keep ? value : maskPii(value);
  }
  if (typeof value === 'number') return maskNumber(value, key);
  if (typeof value === 'bigint') return maskPii(value.toString());
  if (typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return MARKER.binary;
  }
  if (depth >= MAX_JSON_DEPTH) return MARKER.tooDeep;
  if (seen.has(value)) return MARKER.circular;
  seen.add(value);
  try {
    return Array.isArray(value)
      ? maskArray(value, key, depth, seen)
      : maskObject(value, depth, seen);
  } catch {
    return MARKER.unreadable;
  } finally {
    seen.delete(value);
  }
}

/**
 * Masks parsed JSON-like data value by value, so escaped characters in
 * serialized text cannot split a value. Any value under an auth-factor key, or
 * paired with an auth-factor name, is replaced whole; registry ids and UUIDs
 * under id keys are kept; long integers are masked unless they are a plausible
 * epoch-ms timestamp under a time key or an amount under an amount key, and
 * other fractions are rounded to 6 significant digits. Keys are masked too.
 * Circular, very deep, binary or unreadable data becomes a marker.
 */
export function maskJson(value: unknown): unknown {
  return maskValue(value, '', 0, new WeakSet());
}
