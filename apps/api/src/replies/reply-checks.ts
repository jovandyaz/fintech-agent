import { maskPii, type ReplyCheckCode } from '@fintech-agent/contracts';

import {
  ALLOWED_REPLY_HOSTS,
  hasLinkOutsideAllowList,
} from './link-scanner.js';

const DIACRITICS = /\p{M}/gu;
const SENTENCE_END = /[.!?;]+/;
const FACTOR_MARK = '\uE000';

const FACTOR =
  /\b(?:nip|pin|cvv2?|cvc|otp|contrasenas?|password|token|clave(?! (?:de rastreo|interbancaria))|codigo (?:de (?:seguridad|verificacion|acceso|autorizacion)|dinamico|(?:que|del|por|via) [^.!?;]{0,30}?\bsms\b|que (?:te )?(?:llego|recibiste|enviamos|mandamos))|digitos [^.!?;]{0,20}?\b(?:reverso|atras|seguridad))\b/g;

// Spanish puts the negated verb right before what it governs, so between a
// warning and the factor it covers only possessives, other factors and list
// words may sit; "no compartas esto con nadie, pero envíanos tu NIP" is a request.
const GOVERNED_TAIL =
  /(?:[\s,\uE000]|\b(?:tu|tus|su|sus|el|la|los|las|ni|o|y)\b)*$/;
const WARNING =
  /\b(?:no|nunca|jamas)\b(?:[\s,]+(?:te|nos|le|lo|la|se|por ningun motivo|en ningun caso|bajo ninguna circunstancia))*[\s,]+(?:pediremos|pedimos|pedira|solicitaremos|solicitamos|solicitara|necesitamos|requerimos|compartas|des|envies|proporciones|reveles|digas|escribas)(?:\s+que(?:\s+(?:nos|me|le))?\s+(?:confirmes|envies|compartas|des|digas|proporciones|escribas))?$/;

function isWarned(sentence: string, factorAt: number): boolean {
  const before = sentence
    .slice(0, factorAt)
    .replace(FACTOR, FACTOR_MARK)
    .replace(GOVERNED_TAIL, '');
  return WARNING.test(before);
}

/**
 * Fails closed: a reply may name an authentication factor only inside a
 * warning not to share it (IFPE rules art. 18 fr. III). Any other mention,
 * a request or not, is a violation the operator or the repair turn rewords.
 */
function namesAuthFactor(text: string): boolean {
  const plain = text.normalize('NFKD').replace(DIACRITICS, '').toLowerCase();
  return plain
    .split(SENTENCE_END)
    .some((sentence) =>
      [...sentence.matchAll(FACTOR)].some(
        ({ index }) => !isWarned(sentence, index),
      ),
    );
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
