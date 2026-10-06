const MASK = '••••';
const FACTOR = '[factor]';
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

const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const GLUED_DIGITS = /(?<![\d•])\d{13,19}(?!\d)/g;
const SEPARATOR = String.raw`[\s./_()\-]{1,3}`;
const DIGIT_CLUSTER = new RegExp(
  String.raw`(?<![\p{L}\d_•])[+(]?\d+(?:${SEPARATOR}\d+)*(?![\p{L}\d_])`,
  'gu',
);
const SEPARATOR_SPLIT = new RegExp(`(${SEPARATOR})`);

const CURP =
  /[A-Z]{4}[\s-]?\d{6}[\s-]?[HM][A-Z]{5}[\s-]?[A-Z\d]\d(?![\p{L}\d])/giu;
const RFC = /(?<!\d)[A-ZÑ&]{3,4}[\s-]?\d{6}[\s-]?[A-Z\d]{3}(?![\p{L}\d])/giu;

const AUTH_KEYWORD = String.raw`(?:cvv2?|cvc2?|nip|pin|otp|token|c[oó]digo|contrase[ñn]a|clave|password|passcode)(?!\p{L})`;
const AUTH_GAP = String.raw`(?:[^\d\n.!?•]{0,40}[^\p{L}\d\n.!?•])?`;
const AUTH_DIGITS = String.raw`\d(?:[ -]?\d){2,7}`;
const AUTH_FACTOR_AFTER = new RegExp(
  String.raw`(?<!\p{L})(${AUTH_KEYWORD})(${AUTH_GAP})${AUTH_DIGITS}(?!\d)`,
  'giu',
);
const AUTH_FACTOR_BEFORE = new RegExp(
  String.raw`(?<![\d•])${AUTH_DIGITS}(\s+(?:es|era|fue)\s+(?:(?:mi|el|la|tu)\s+)?${AUTH_KEYWORD})`,
  'giu',
);
const NOT_AN_AUTH_FACTOR = /postal|rastreo|referencia|folio|interbancaria/i;

const EMAIL =
  /(?<![\p{L}\p{N}._%+-])([\p{L}\p{N}])[\p{L}\p{N}._%+-]*@([\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,})/gu;

const AUTH_FACTOR_KEY =
  /^(?:otp|nip|pin|cvv2?|cvc2?|password|passcode|token|c[oó]digo)$/i;
const AUTH_FACTOR_VALUE = /^\d{3,8}$/;

const LABEL = { clabe: 'CLABE', card: 'tarjeta', phone: 'tel' } as const;
type DigitKind = keyof typeof LABEL;

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

function render(kind: DigitKind, digits: string): string {
  return `${LABEL[kind]} ${MASK}${digits.slice(-VISIBLE_DIGITS)}`;
}

function maskGluedDigits(digits: string): string {
  if (isValidClabe(digits)) return render('clabe', digits);
  return isCard(digits) ? render('card', digits) : digits;
}

function maskDigitCluster(match: string): string {
  const prefix = /^[+(]/.test(match) ? match.charAt(0) : '';
  const parts = match.slice(prefix.length).split(SEPARATOR_SPLIT);
  const groups = parts.filter((_, i) => i % 2 === 0);
  const separators = parts.filter((_, i) => i % 2 === 1);

  const out: string[] = [];
  let i = 0;
  while (i < groups.length) {
    const lead = i === 0 ? prefix : (separators[i - 1] ?? '');
    let kind: DigitKind | null = null;
    let matchedEnd = i;
    let digitCount = 0;
    for (
      let end = i + 1;
      end <= groups.length && end - i <= MAX_WINDOW_GROUPS;
      end++
    ) {
      digitCount += groups[end - 1]?.length ?? 0;
      if (digitCount > CARD_MAX_DIGITS) break;
      const windowKind = classifyWindow(groups.slice(i, end));
      if (windowKind) {
        kind = windowKind;
        matchedEnd = end;
      }
    }
    if (kind) {
      out.push(
        i === 0 ? '' : lead,
        render(kind, groups.slice(i, matchedEnd).join('')),
      );
      i = matchedEnd;
    } else {
      out.push(lead, groups[i] ?? '');
      i++;
    }
  }
  return out.join('');
}

function maskSegment(text: string): string {
  return text
    .replace(GLUED_DIGITS, maskGluedDigits)
    .replace(DIGIT_CLUSTER, maskDigitCluster)
    .replace(CURP, `CURP ${MASK}`)
    .replace(RFC, `RFC ${MASK}`)
    .replace(AUTH_FACTOR_AFTER, (match, keyword: string, gap: string) =>
      NOT_AN_AUTH_FACTOR.test(gap) ? match : `${keyword}${gap}${FACTOR}`,
    )
    .replace(AUTH_FACTOR_BEFORE, (_, rest: string) => `${FACTOR}${rest}`)
    .replace(
      EMAIL,
      (_, first: string, domain: string) => `${first}•••@${domain}`,
    );
}

/**
 * Masks personal data in free text: CLABE (control digit), card numbers
 * (Luhn), RFC, CURP, email, Mexican phone numbers and authentication factors.
 * Normalizes to NFKC first so look-alike digits and spaces cannot hide a value.
 * Idempotent and linear in the input length; UUIDs are left untouched.
 */
export function maskPii(text: string): string {
  return text
    .normalize('NFKC')
    .split(UUID)
    .map((segment, i) => (i % 2 === 1 ? segment : maskSegment(segment)))
    .join('');
}

/**
 * Masks every string value of parsed JSON-like data, so escaped characters in
 * serialized text cannot split a value. Keys named like an auth factor have
 * their numeric value replaced too. Other leaves are returned unchanged.
 */
export function maskJson(value: unknown, key?: string): unknown {
  const isFactorKey = key !== undefined && AUTH_FACTOR_KEY.test(key);
  if (typeof value === 'string') {
    return isFactorKey && AUTH_FACTOR_VALUE.test(value)
      ? FACTOR
      : maskPii(value);
  }
  if (typeof value === 'number') return isFactorKey ? FACTOR : value;
  if (Array.isArray(value)) return value.map((item) => maskJson(item));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, maskJson(v, k)]),
    );
  }
  return value;
}
