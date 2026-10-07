import { QUALIFIERS, UNITS, alternation, foldForMatching } from './spanish.js';

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
const DEADLINE = String.raw`\b(?:en|dentro de)\s\d+\s?(?:${alternation(UNITS)})\b(?:\s(?:${alternation(QUALIFIERS)})\b)?,?\s`;
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
const COMMITMENT = new RegExp(
  [
    String.raw`\b${PRONOUNS}(?:${FUTURE_PROMISES.join('|')})\b`,
    String.raw`\b${PRONOUNS}(?:${PRESENT_PROMISES.join('|')})\b`,
    String.raw`\b${PRONOUNS}(?:${GOING_TO.join('|')})\sa\s(?:${PROMISED_INFINITIVES.join('|')})${ENCLITICS}\b`,
    String.raw`\bya\s${PRONOUNS}(?:${DONE_ACTIONS.join('|')})\b`,
    String.raw`${DEADLINE}(?:${CLITIC}\p{L}+|(?:${OBJECT_PRONOUN})*\p{L}+mos\b|(?:${YOU_WILL.join('|')})\b)`,
  ].join('|'),
  'gu',
);

// Cancels only when it governs the verb: "no te reembolsaremos", "no
// podemos…". "No te preocupes que te reembolsaremos" still promises.
const GOVERNING_NEGATION =
  /(?:^|[^\p{L}])(?:no|nunca|jamas|tampoco)(?:\s(?:podemos|podremos|podriamos|vamos a))?\s$/u;

/**
 * Whether a reply makes a promise or claims a completed action in its own
 * words (02 G5 `COMMITMENT_IN_REPLY`). A negation cancels a match only when
 * it governs the verb directly ("no te reembolsaremos" passes); one that
 * belongs to another clause or verb does not.
 */
export function hasCommitment(text: string): boolean {
  const normalized = foldForMatching(text);
  for (const match of normalized.matchAll(COMMITMENT)) {
    if (!GOVERNING_NEGATION.test(normalized.slice(0, match.index))) return true;
  }
  return false;
}
