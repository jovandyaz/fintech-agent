const MASK = '••••';
const VISIBLE_DIGITS = 4;
const CLABE_DIGITS = 18;
const CARD_MIN_DIGITS = 13;
const CARD_MAX_DIGITS = 19;
const PHONE_DIGITS = 10;
const MX_COUNTRY_CODE = '52';
const PHONE_GROUPINGS = new Set(['10', '2,4,4', '3,3,4', '2,8']);
const LUHN_MODULUS = 10;
const MAX_DECIMAL_DIGIT = 9;

const AUTH_FACTOR_KEYWORDS = String.raw`CVV|CVC|NIP|PIN|OTP|token|c[oó]digo|contrase[ñn]a`;
const AUTH_FACTOR_FILLERS = String.raw`es|era|de|del|mi|el|la|verificaci[oó]n|seguridad|acceso|din[aá]mico`;
const AUTH_FACTOR = new RegExp(
  String.raw`(?<!\p{L})(${AUTH_FACTOR_KEYWORDS})((?:[\s:=]+(?:${AUTH_FACTOR_FILLERS}))*[\s:=]+)\d{3,6}(?!\d)`,
  'giu',
);
const CURP = /(?<![\p{L}\d])[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z\d]\d(?![\p{L}\d])/giu;
const RFC = /(?<![\p{L}\d&])[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}(?![\p{L}\d])/giu;
const EMAIL =
  /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
const CONTIGUOUS_DIGITS = /(?<![\d•])\+?\d{10,19}(?!\d)/g;
const GROUPED_DIGITS = /(?<![\d•])\+?\d{1,19}(?:[ -]\d{1,19})+(?!\d)/g;

type DigitKind = 'clabe' | 'card' | 'phone';

const LABEL: Record<DigitKind, string> = {
  clabe: 'CLABE',
  card: 'tarjeta',
  phone: 'tel',
};

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
  return sum % LUHN_MODULUS === 0;
}

function isPhoneGrouping(groups: string[]): boolean {
  return PHONE_GROUPINGS.has(groups.map((g) => g.length).join(','));
}

function isPhone(groups: string[], grouped: boolean): boolean {
  const digits = groups.join('');
  if (digits.length === PHONE_DIGITS)
    return !grouped || isPhoneGrouping(groups);
  if (digits.length !== PHONE_DIGITS + MX_COUNTRY_CODE.length) return false;
  if (!digits.startsWith(MX_COUNTRY_CODE)) return false;
  if (!grouped) return true;
  return groups[0] === MX_COUNTRY_CODE && isPhoneGrouping(groups.slice(1));
}

function classify(groups: string[], grouped: boolean): DigitKind | null {
  const digits = groups.join('');
  if (digits.length === CLABE_DIGITS) return 'clabe';
  if (
    digits.length >= CARD_MIN_DIGITS &&
    digits.length <= CARD_MAX_DIGITS &&
    passesLuhn(digits)
  ) {
    return 'card';
  }
  return isPhone(groups, grouped) ? 'phone' : null;
}

function render(kind: DigitKind, digits: string): string {
  return `${LABEL[kind]} ${MASK}${digits.slice(-VISIBLE_DIGITS)}`;
}

function maskContiguous(match: string): string {
  const digits = match.replace('+', '');
  const kind = classify([digits], false);
  return kind ? render(kind, digits) : match;
}

function maskGrouped(match: string): string {
  const plus = match.startsWith('+') ? '+' : '';
  const parts = match.slice(plus.length).split(/([ -])/);
  const groups = parts.filter((_, i) => i % 2 === 0);
  const separators = parts.filter((_, i) => i % 2 === 1);

  const out: string[] = [];
  let i = 0;
  while (i < groups.length) {
    const separator = i === 0 ? '' : (separators[i - 1] ?? '');
    let end = groups.length;
    let kind: DigitKind | null = null;
    for (; end > i; end--) {
      kind = classify(groups.slice(i, end), true);
      if (kind) break;
    }
    if (kind) {
      out.push(separator, render(kind, groups.slice(i, end).join('')));
      i = end;
    } else {
      out.push(separator, (i === 0 ? plus : '') + (groups[i] ?? ''));
      i++;
    }
  }
  return out.join('');
}

/**
 * Masks personal data in free text: CLABE, card numbers (Luhn), RFC, CURP,
 * email, Mexican phone numbers and authentication factors after a keyword.
 * Idempotent; leaves amounts, dates, ids and short numbers untouched.
 */
export function maskPii(text: string): string {
  return text
    .replace(
      AUTH_FACTOR,
      (_, keyword: string, gap: string) => `${keyword}${gap}[factor]`,
    )
    .replace(CURP, `CURP ${MASK}`)
    .replace(RFC, `RFC ${MASK}`)
    .replace(
      EMAIL,
      (_, first: string, domain: string) => `${first}•••@${domain}`,
    )
    .replace(CONTIGUOUS_DIGITS, maskContiguous)
    .replace(GROUPED_DIGITS, maskGrouped);
}
