import {
  GROUPED,
  QUALIFIER_WORD,
  RANGE_DASH,
  RANGE_JOIN,
  UNIT_WORD,
  foldForMatching,
} from './spanish.js';

const CLITIC = String.raw`(?:te|le|les)\s`;
const OBJECT_PRONOUN = String.raw`(?:lo|la|los|las|se|nos|te|le|les)\s`;
// "Te lo devolveremos", "se lo vamos a reembolsar": up to two pronouns.
const PRONOUNS = `(?:${OBJECT_PRONOUN}){0,2}`;
// "devolverte", "abonárselo": pronouns glued to the infinitive.
const ENCLITICS = '(?:te|le|les|lo|la|los|las|se|nos)*';
const PROMISED_INFINITIVES = ['reembolsar', 'devolver', 'abonar', 'depositar'];
const FUTURE_ENDINGS = ['e', 'as', 'a', 'emos', 'eis', 'an'];
// Every person of the future, and of "garantizar" in the present: "te
// reembolsarán" promises as much as "te reembolsaremos".
const FUTURE_PROMISES = [
  ...PROMISED_INFINITIVES.flatMap((verb) =>
    FUTURE_ENDINGS.map((ending) => verb + ending),
  ),
  'garantizo',
  'garantizas',
  'garantiza',
  'garantizamos',
  'garantizan',
];
// The present promises too ("mañana te devuelven"); the first person
// singular is left out because it is the noun ("reembolso", "abono").
const PRESENT_PROMISES = [
  'devuelves',
  'devuelve',
  'devolvemos',
  'devuelven',
  'reembolsas',
  'reembolsa',
  'reembolsamos',
  'reembolsan',
  'abonas',
  'abona',
  'abonamos',
  'abonan',
  'depositas',
  'deposita',
  'depositamos',
  'depositan',
];
const GOING_TO = ['voy', 'vas', 'va', 'vamos', 'van'];
const DONE_ACTIONS = [
  'abrimos',
  'escalamos',
  'enviamos',
  'reembolsamos',
  'abonamos',
  'devolvimos',
  'depositamos',
];
const ONE_FIGURE = String.raw`(?:${GROUPED}|\d+)(?:[.,]\d{1,2})?(?:\smil\b)?`;
// "En 3 cinco días", "en 5,quinientos días": folding sets a number word after
// a figure apart ("3 · 5", "5,· 500").
const DEADLINE_FIGURE = String.raw`${ONE_FIGURE}(?:[,.]?\s?·\s${ONE_FIGURE})*`;
const DEADLINE = String.raw`\b(?:en|dentro de|entre)\s${DEADLINE_FIGURE}(?:\s?${RANGE_DASH}\s?${DEADLINE_FIGURE}|\s${RANGE_JOIN}\s${DEADLINE_FIGURE})?\s?${UNIT_WORD}(?:\s${QUALIFIER_WORD})?,?\s`;
const YOU_WILL = [
  'tendras',
  'tendra',
  'recibiras',
  'recibira',
  'veras',
  'vera',
];

// Verb forms, never stems: "reembolso" or "abono" alone promise nothing. The
// pronouns sit inside the match so a negation right before them governs it.
// Each form is searched on its own: a negation that cancels one ("no en 3
// días te devolvemos") must not hide the verb another form finds in it.
const COMMITMENTS = [
  String.raw`\b${PRONOUNS}(?:${FUTURE_PROMISES.join('|')})\b`,
  String.raw`\b${PRONOUNS}(?:${PRESENT_PROMISES.join('|')})\b`,
  String.raw`\b${PRONOUNS}(?:${GOING_TO.join('|')})\sa\s(?:${PROMISED_INFINITIVES.join('|')})${ENCLITICS}\b`,
  String.raw`\bya\s${PRONOUNS}(?:${DONE_ACTIONS.join('|')})\b`,
  String.raw`${DEADLINE}(?:${CLITIC}\p{L}+|(?:${OBJECT_PRONOUN})*\p{L}+mos\b|(?:${YOU_WILL.join('|')})\b)`,
].map((form) => new RegExp(form, 'gu'));

// Cancels only when it governs the verb: "no te reembolsaremos", "no
// podemos…". "No te preocupes que te reembolsaremos" still promises.
const GOVERNING_NEGATION =
  /(?:^|[^\p{L}])(?:no|nunca|jamas|tampoco)(?:\s(?:podemos|podremos|podriamos|vamos a))?\s$/u;

/**
 * A refusal that names no listed verb, which the repair turn offers as the way
 * to decline a promise: the check flags "no puedo confirmarte que te
 * reembolsaremos" on purpose (02 G5).
 */
export const REFUSAL_WITHOUT_PROMISE =
  'No podemos prometerte el monto ni el plazo que nos pides.';

/**
 * Whether a reply makes a promise or claims a completed action in its own
 * words (02 G5 `COMMITMENT_IN_REPLY`). A negation cancels a match only when
 * it governs the verb directly ("no te reembolsaremos" passes); one that
 * belongs to another clause or verb does not.
 */
export function hasCommitment(text: string): boolean {
  const normalized = foldForMatching(text);
  return COMMITMENTS.some((form) =>
    [...normalized.matchAll(form)].some(
      (match) => !GOVERNING_NEGATION.test(normalized.slice(0, match.index)),
    ),
  );
}
