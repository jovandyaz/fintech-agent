const THOUSAND = 1000;
const LONE_THOUSAND = 'mil';
// "¡Mil gracias!" is courtesy, not a figure. Denied by the noun that follows,
// so a lone "mil" in any other slot ("recibirás mil") still reads as 1,000.
const COURTESY_NEXT =
  /^\s(?:gracias|disculpas|perdones|besos|abrazos|bendiciones|veces)\b/;

const WORD_VALUES: Readonly<Record<string, number>> = {
  cero: 0,
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiun: 21,
  veintiuno: 21,
  veintiuna: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
  cien: 100,
  ciento: 100,
  doscientos: 200,
  doscientas: 200,
  trescientos: 300,
  trescientas: 300,
  cuatrocientos: 400,
  cuatrocientas: 400,
  quinientos: 500,
  quinientas: 500,
  seiscientos: 600,
  seiscientas: 600,
  setecientos: 700,
  setecientas: 700,
  ochocientos: 800,
  ochocientas: 800,
  novecientos: 900,
  novecientas: 900,
  mil: THOUSAND,
};

const WORD = Object.keys(WORD_VALUES)
  .toSorted((a, b) => b.length - a.length)
  .join('|');
// Not after a digit ("5 mil pesos" is read as a whole by the amount
// patterns) nor in "por ciento", where "ciento" is no figure.
const RUN = new RegExp(
  String.raw`(?<!\d\s?|\bpor\s)\b(?:${WORD})(?:\s+(?:y\s+)?(?:${WORD}))*\b`,
  'g',
);
const WHITESPACE = /\s+/;
// Grouped like a written figure, so "cinco mil" reads as the amount "5,000".
const THOUSANDS_GROUP = /\B(?=(\d{3})+(?!\d))/g;

function valueOf(run: string): number {
  let total = 0;
  let group = 0;
  for (const word of run.split(WHITESPACE)) {
    const value = WORD_VALUES[word];
    if (value === undefined) continue;
    if (value === THOUSAND) {
      total += (group === 0 ? 1 : group) * THOUSAND;
      group = 0;
    } else {
      group += value;
    }
  }
  return total + group;
}

/**
 * Rewrites Spanish number words as digits ("cuarenta y cinco días" → "45
 * días", "cinco mil" → "5,000") so a figure spelled out is read like one written in digits. Takes
 * text already lowercased and stripped of accents. "y" joins words only
 * between two number words; articles ("un", "una") become 1, which only
 * matters before a unit or a currency. A lone "mil" before a courtesy noun
 * ("mil gracias") stays a word.
 */
export function foldNumberWords(text: string): string {
  return text.replace(RUN, (run: string, offset: number) =>
    run === LONE_THOUSAND && COURTESY_NEXT.test(text.slice(offset + run.length))
      ? run
      : String(valueOf(run)).replace(THOUSANDS_GROUP, ','),
  );
}
