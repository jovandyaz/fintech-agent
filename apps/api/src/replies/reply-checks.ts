import { maskPii, type ReplyCheckCode } from '@fintech-agent/contracts';

import {
  ALLOWED_REPLY_HOSTS,
  hasLinkOutsideAllowList,
} from './link-scanner.js';

const SENTENCE_END = /[.!?¿¡\n]+/;
const DIACRITICS = /\p{M}/gu;

const FACTOR =
  /\b(?:nip|pin|cvv2?|cvc|otp|contrasenas?|password|token|codigo (?:de (?:seguridad|verificacion|acceso)|dinamico|que te (?:llego|enviamos))|clave (?:dinamica|de (?:acceso|seguridad)))\b/g;
const REQUEST =
  /\b(?:envia(?:nos|me)?|manda(?:nos|me)?|comparte(?:nos)?|compartenos|proporciona(?:nos)?|proporcionanos|indica(?:nos)?|indicanos|dinos|dime|escribe(?:nos)?|escribenos|confirma(?:nos)?|confirmanos|dicta(?:nos)?|dictanos|pasa(?:nos)?|pasanos|ingresa|captura|necesitamos|requerimos|nos (?:das|compartes|confirmas|envias|proporcionas|indicas)|(?:puedes|podrias) (?:darnos|compartir(?:nos)?|enviar(?:nos)?|confirmar(?:nos)?|indicar(?:nos)?)|cual es tu)\b/g;
// Spanish negation sits right before its verb, with only clitics or a set
// phrase between ("nunca, por ningún motivo, te pediremos"), so "No te
// preocupes, envíanos tu NIP" is still a request.
const NEGATED =
  /\b(?:no|nunca|jamas)\b(?:[\s,]+(?:te|nos|me|lo|la|le|les|se|por ningun motivo|en ningun caso|bajo ninguna circunstancia))*[\s,]*$/;

function asksForAuthFactor(text: string): boolean {
  const plain = text.normalize('NFKD').replace(DIACRITICS, '').toLowerCase();
  return plain.split(SENTENCE_END).some((sentence) => {
    const requests = [...sentence.matchAll(REQUEST)]
      .map((match) => match.index)
      .filter((index) => !NEGATED.test(sentence.slice(0, index)));
    return [...sentence.matchAll(FACTOR)].some(({ index: factorAt }) =>
      requests.some((requestAt) => requestAt < factorAt),
    );
  });
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
  if (asksForAuthFactor(text)) codes.push('AUTH_FACTOR_REQUEST');
  return codes;
}
