import { maskPii, type ReplyCheckCode } from '@fintech-agent/contracts';

import {
  ALLOWED_REPLY_HOSTS,
  hasLinkOutsideAllowList,
} from './link-scanner.js';

const DIACRITICS = /\p{M}/gu;
const SENTENCE_END = /[.!?;]+/;
const FACTOR_MARK = '';

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
  /(?<![\p{L}\d])(?:[\p{L}\d][.\s\-·_]+){1,7}[\p{L}\d](?![\p{L}\d])/gu;
const SPELLING_SEPARATOR = /[.\s\-·_]+/g;
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

const FACTOR =
  /\b(?:nips?|pins?|cvv2?s?|cvc2?s?|otps?|contra[sc]en(?:a|ia)s?|passwords?|passcodes?|passwd|pwd|tokens?|claves?(?! (?:de (?:rastreo|aclaracion)|interbancaria))|llaves? dinamicas?|codigos?(?! (?:postal(?:es)?|de (?:rastreo|aclaracion|autorizacion|barras|promocion|referencia)))|(?:numeros?|numeritos?|codigos?|claves?) secret[oa]s?|(?:digitos|numeros) [^.!?;]{0,20}?\b(?:reverso|atras|seguridad)|one[- ]time (?:code|password))\b/g;

// Spanish puts the negated verb right before what it governs, so between a
// warning and its factor only possessives, other factors and list words may
// sit, and an exception after it ("excepto a nosotros") voids the warning.
const GOVERNED_TAIL =
  /(?:[\s,]|\b(?:tu|tus|su|sus|el|la|los|las|ni|o|y|a nadie)\b)*$/;
const WARNING =
  /\b(?:no|nunca|jamas|ni|nadie|ningun[oa]?|evita|evite)\b(?:[\s,]+\p{L}+){0,5}?[\s,]+(?:pediremos|pedimos|pedira|pediran|pide|solicitaremos|solicitamos|solicitara|solicitaran|solicita|necesitamos|requerimos|requerira|requeriran|preguntaremos|preguntara|preguntaran|compartas|compartir|des|dar|envies|enviar|proporciones|proporcionar|reveles|revelar|digas|decir|escribas|escribir)(?:[\s,]+(?:jamas|nunca|con nadie|a nadie|por (?:\p{L}+\s+){0,2}\p{L}+|que(?:\s+(?:nos|me|le))?\s+(?:confirmes|envies|compartas|des|digas|proporciones|escribas)))*$/u;
const EXCEPTION =
  /\b(?:excepto|salvo|menos|sino|a nosotros si|con nosotros si|solo a nosotros|unicamente a nosotros|a nosotros tambien)\b/;

const normalize = (text: string): string =>
  text
    .normalize('NFKC')
    .replace(LOOKALIKE, (character) => LOOKALIKES[character] ?? character)
    .normalize('NFKD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(SPELLED_OUT, (run) => run.replace(SPELLING_SEPARATOR, ''));

const FACTOR_WORD =
  /^(?:nips?|pins?|cvv2?s?|cvc2?s?|otps?|contra[sc]en(?:a|ia)s?|passwords?|passcodes?|passwd|pwd|tokens?|claves?|codigos?)$/;
const TOKEN = /[\p{L}\d@$]+/gu;

// Folding every "l" and digit would break the words around a factor
// ("solicitara", "postal"), so only a token that becomes a factor is folded.
const unleetFactors = (text: string): string =>
  text.replace(TOKEN, (token) => {
    const folded = token.replace(
      LEET_CHARACTER,
      (character) => LEET[character] ?? character,
    );
    return FACTOR_WORD.test(folded) && !FACTOR_WORD.test(token)
      ? folded
      : token;
  });

function isWarned(
  sentence: string,
  factorAt: number,
  factorEnd: number,
): boolean {
  const before = sentence
    .slice(0, factorAt)
    .replace(FACTOR, FACTOR_MARK)
    .replace(GOVERNED_TAIL, '');
  return WARNING.test(before) && !EXCEPTION.test(sentence.slice(factorEnd));
}

function namesFactorOutsideWarning(plain: string): boolean {
  return plain
    .split(SENTENCE_END)
    .some((sentence) =>
      [...sentence.matchAll(FACTOR)].some(
        ({ index, 0: factor }) =>
          !isWarned(sentence, index, index + factor.length),
      ),
    );
}

/**
 * Fails closed: a reply may name an authentication factor only inside a
 * warning not to share it (IFPE rules art. 18 fr. III). Any other mention,
 * a request or not, is a violation the operator or the repair turn rewords.
 * Spelled-out, look-alike and digit-for-letter spellings count as the factor.
 */
function namesAuthFactor(text: string): boolean {
  return namesFactorOutsideWarning(unleetFactors(normalize(text)));
}

/**
 * The reply checks of 02 G5 that apply to any text sent to a customer: the
 * model's draft and the operator's `final_reply` alike. Empty means clean.
 */
export function replyViolations(text: string): ReplyCheckCode[] {
  const codes: ReplyCheckCode[] = [];
  if (maskPii(text) !== text) codes.push('PII_IN_REPLY');
  if (hasLinkOutsideAllowList(text, ALLOWED_REPLY_HOSTS)) {
    codes.push('LINK_IN_REPLY');
  }
  if (namesAuthFactor(text)) codes.push('AUTH_FACTOR_REQUEST');
  return codes;
}
