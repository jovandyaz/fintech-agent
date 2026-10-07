import { foldNumberWords } from './number-words.js';

const IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;
const DIACRITICS = /\p{M}/gu;
const WHITESPACE = /\s+/g;

const CLITIC = String.raw`(?:te|le|les)\s`;
const OBJECT_PRONOUN = String.raw`(?:lo|la|los|las|se|nos|te|le|les)\s`;
const FUTURE_PROMISES = [
  'reembolsaremos',
  'devolveremos',
  'abonaremos',
  'depositaremos',
  'garantizamos',
];
const PRESENT_PROMISES = [
  'devolvemos',
  'reembolsamos',
  'abonamos',
  'depositamos',
];
const PROMISED_INFINITIVES = ['reembolsar', 'devolver', 'abonar', 'depositar'];
const DONE_ACTIONS = [
  'abrimos',
  'escalamos',
  'enviamos',
  'reembolsamos',
  'abonamos',
  'devolvimos',
  'depositamos',
];
const DEADLINE = String.raw`\b(?:en|dentro de)\s\d+\s?(?:minutos?|horas?|hrs?|hs?|dias?|semanas?|mes|meses)(?:\s(?:habil(?:es)?|natural(?:es)?|bancarios?))?,?\s`;
const YOU_WILL = [
  'tendras',
  'tendra',
  'recibiras',
  'recibira',
  'veras',
  'vera',
];

// Verb forms, never stems: "reembolso" or "abono" alone promise nothing. The
// clitic sits inside the match so a negation right before it governs it.
const COMMITMENT = new RegExp(
  [
    String.raw`\b(?:${CLITIC})?(?:${FUTURE_PROMISES.join('|')})\b`,
    String.raw`\b(?:${CLITIC})?(?:${PRESENT_PROMISES.join('|')})\b`,
    String.raw`\b${CLITIC}vamos\sa\s(?:${PROMISED_INFINITIVES.join('|')})\b`,
    String.raw`\bya\s(?:${DONE_ACTIONS.join('|')})\b`,
    String.raw`${DEADLINE}(?:${CLITIC}\p{L}+|(?:${OBJECT_PRONOUN})*\p{L}+mos\b|(?:${YOU_WILL.join('|')})\b)`,
  ].join('|'),
  'gu',
);

// Cancels only when it governs the verb: "no te reembolsaremos", "no
// podemos…". "No te preocupes que te reembolsaremos" still promises.
const GOVERNING_NEGATION =
  /(?:^|[^\p{L}])(?:no|nunca|jamas|tampoco)(?:\s(?:podemos|podremos|podriamos|vamos a))?\s$/u;

const normalize = (text: string): string =>
  foldNumberWords(
    text
      .normalize('NFKD')
      .replace(DIACRITICS, '')
      .replace(IGNORABLE, '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(WHITESPACE, ' '),
  );

/**
 * Whether a reply makes a promise or claims a completed action in its own
 * words (02 G5 `COMMITMENT_IN_REPLY`). A negation cancels a match only when
 * it governs the verb directly ("no te reembolsaremos" passes); one that
 * belongs to another clause or verb does not.
 */
export function hasCommitment(text: string): boolean {
  const normalized = normalize(text);
  for (const match of normalized.matchAll(COMMITMENT)) {
    if (!GOVERNING_NEGATION.test(normalized.slice(0, match.index))) return true;
  }
  return false;
}
