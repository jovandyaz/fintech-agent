import {
  APPROVED_FACTOR_WARNINGS,
  hasPii,
  type ReplyCheckCode,
} from '@fintech-agent/contracts';

import {
  ALLOWED_REPLY_HOSTS,
  hasLinkOutsideAllowList,
} from './link-scanner.js';

const IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;
const DIACRITICS = /\p{M}/gu;
const WHITESPACE = /\s+/g;

const LOOKALIKES: Record<string, string> = {
  Α: 'a',
  Β: 'b',
  Ε: 'e',
  Ζ: 'z',
  Η: 'h',
  Ι: 'i',
  Κ: 'k',
  Μ: 'm',
  Ν: 'n',
  Ο: 'o',
  Ρ: 'p',
  Τ: 't',
  Υ: 'y',
  Χ: 'x',
  ο: 'o',
  ι: 'i',
  ν: 'v',
  ρ: 'p',
  А: 'a',
  В: 'b',
  Е: 'e',
  К: 'k',
  М: 'm',
  Н: 'h',
  О: 'o',
  Р: 'p',
  С: 'c',
  Т: 't',
  У: 'y',
  Х: 'x',
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  у: 'y',
  х: 'x',
  і: 'i',
  ј: 'j',
};
const LOOKALIKE = new RegExp(`[${Object.keys(LOOKALIKES).join('')}]`, 'gu');
const SPELLED_OUT =
  /(?<![\p{L}\d])(?:[\p{L}\d][.\s\-·_]){1,7}[\p{L}\d](?![\p{L}\d])/gu;
const SPELLING_SEPARATOR = /[.\s\-·_]/g;
const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  l: 'i',
  '@': 'a',
  $: 's',
};
const LEET_CHARACTER = /[013457l@$]/g;
const TOKEN = /[\p{L}\d@$]+/gu;

const FACTOR_WORDS = [
  'nips?',
  'pins?',
  'cvv2?s?',
  'cvc2?s?',
  'otps?',
  'contra[sc]en(?:a|ia)s?',
  'passwords?',
  'passcodes?',
  'passwd',
  'pwd',
  'tokens?',
  'sms',
  'claves?',
  'codigos?',
] as const;
const NOT_A_FACTOR_AFTER: Partial<
  Record<(typeof FACTOR_WORDS)[number], string>
> = {
  'claves?': '(?! (?:de (?:rastreo|aclaracion)|interbancaria))',
  'codigos?':
    '(?! (?:postal(?:es)?|de (?:rastreo|aclaracion|autorizacion|barras|promocion|referencia)))',
};
const FACTOR_PHRASES = [
  'llaves? dinamicas?',
  '(?:numeros?|numeritos?) secret[oa]s?',
  '(?:digitos|numeros) [^.!?;]{0,20}?\\b(?:reverso|atras|seguridad)',
  'one[- ]time (?:code|password)',
  'mensajes? de texto',
] as const;

// A spelled-out run joins into one token with its neighbours ("N I P a" is
// "nipa"), so the factors inside the run are added back as words.
const SPELLED_FACTORS = [
  'nip',
  'pin',
  'cvv',
  'cvc',
  'otp',
  'sms',
  'token',
  'clave',
  'codigo',
] as const;

const FACTOR = new RegExp(
  `\\b(?:${[
    ...FACTOR_WORDS.map((word) => `${word}${NOT_A_FACTOR_AFTER[word] ?? ''}`),
    ...FACTOR_PHRASES,
  ].join('|')})\\b`,
);
const FACTOR_WORD = new RegExp(`^(?:${FACTOR_WORDS.join('|')})$`);

const unleet = (text: string): string =>
  text.replace(LEET_CHARACTER, (character) => LEET[character] ?? character);

function spelledRun(run: string): string {
  const joined = run.replace(SPELLING_SEPARATOR, '');
  const inside = SPELLED_FACTORS.filter((factor) =>
    unleet(joined).includes(factor),
  );
  return [joined, ...inside].join(' ');
}

const normalize = (text: string): string =>
  text
    .replace(IGNORABLE, '')
    .normalize('NFKC')
    .replace(LOOKALIKE, (character) => LOOKALIKES[character] ?? character)
    .normalize('NFKD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(WHITESPACE, ' ')
    .replace(SPELLED_OUT, spelledRun);

// Folding every "l" and digit would break ordinary words ("solicitara",
// "postal"), so only a token that becomes a factor is folded.
const unleetFactors = (text: string): string =>
  text.replace(TOKEN, (token) => {
    const folded = unleet(token);
    return FACTOR_WORD.test(folded) && !FACTOR_WORD.test(token)
      ? folded
      : token;
  });

const APPROVED = APPROVED_FACTOR_WARNINGS.map((warning) =>
  normalize(warning).replace(/[.!]+$/, ''),
);

// Fails closed (IFPE rules art. 18 fr. III): a factor may appear only inside
// an approved warning, and any other mention is reworded by the operator or
// the repair turn.
function namesAuthFactor(text: string): boolean {
  const outsideWarnings = APPROVED.reduce(
    (remaining, warning) => remaining.replaceAll(warning, ' '),
    normalize(text),
  );
  return FACTOR.test(unleetFactors(outsideWarnings));
}

/**
 * The reply checks of 02 G5 that apply to any text sent to a customer: the
 * model's draft and the operator's `final_reply` alike. Empty means clean.
 */
export function replyViolations(text: string): ReplyCheckCode[] {
  const codes: ReplyCheckCode[] = [];
  if (hasPii(text)) codes.push('PII_IN_REPLY');
  if (hasLinkOutsideAllowList(text, ALLOWED_REPLY_HOSTS)) {
    codes.push('LINK_IN_REPLY');
  }
  if (namesAuthFactor(text)) codes.push('AUTH_FACTOR_REQUEST');
  return codes;
}
