import { describe, expect, it } from 'vitest';

import { groundingAtoms, numberAtoms, ungroundedAtoms } from './numbers.js';

describe('numberAtoms, amounts', () => {
  it('reads amounts with a currency mark, in cents', () => {
    expect(numberAtoms('Te cobraron $1,299.50 y luego 300 pesos')).toEqual([
      'amount:129950',
      'amount:30000',
    ]);
    expect(numberAtoms('un cargo de 5 mil pesos y otro de 2500 MXN')).toEqual([
      'amount:500000',
      'amount:250000',
    ]);
  });

  it('reads one amount where two marks overlap', () => {
    expect(numberAtoms('un cargo de $5,000 pesos')).toEqual(['amount:500000']);
  });

  it('reads a currency mark before or after the figure', () => {
    expect(numberAtoms('MXN 5,000 o MXN 5000 o 5,000 M.N.')).toEqual([
      'amount:500000',
      'amount:500000',
      'amount:500000',
    ]);
    expect(numberAtoms('un cargo de $5,000 MXN')).toEqual(['amount:500000']);
  });

  it('reads dollars, euros and cents as amounts', () => {
    expect(
      numberAtoms(
        'Recibirás 50 dólares, 60 USD, €70, 80 euros, 1500dlls o USD 90.',
      ),
    ).toEqual([
      'amount:5000',
      'amount:6000',
      'amount:7000',
      'amount:8000',
      'amount:150000',
      'amount:9000',
    ]);
    expect(numberAtoms('una diferencia de 50 centavos')).toEqual(['amount:50']);
  });

  it('reads a figure before a currency it does not list, spaced or glued', () => {
    expect(numberAtoms('50 libras, 20yenes o 3 btc')).toEqual([
      'amount:5000',
      'amount:2000',
      'amount:300',
    ]);
  });

  it('reads a figure with thousands or cents, or spelled out, with no currency word', () => {
    expect(
      numberAtoms('Recibirás 5,000 de vuelta, luego 1,299.50 y luego 12500'),
    ).toEqual(['amount:500000', 'amount:129950', 'amount:1250000']);
    expect(numberAtoms('Recibirás cinco mil de vuelta')).toEqual([
      'amount:500000',
    ]);
  });

  it('reads a bare figure of any length as an amount', () => {
    expect(
      numberAtoms('Te devolvemos 50, recibirás 2000 de vuelta, son 7.'),
    ).toEqual(['amount:5000', 'amount:200000', 'amount:700']);
  });

  it('reads a bare figure after Markdown marks or a bullet', () => {
    expect(
      numberAtoms('Recibirás 5000 de vuelta y un cargo de 899 queda igual'),
    ).toEqual(['amount:500000', 'amount:89900']);
    expect(numberAtoms('el máximo es max 500 al final 700')).toEqual([
      'amount:50000',
      'amount:70000',
    ]);
    expect(
      numberAtoms('Te devolveremos **4500** de vuelta, • 899 o * 750'),
    ).toEqual(['amount:450000', 'amount:89900', 'amount:75000']);
  });

  it('reads a figure glued to a letter, underscore or mark', () => {
    expect(
      numberAtoms('Recibirás _5000 pesos_, MN5000, dlls50 o Q500'),
    ).toEqual([
      'amount:500000',
      'amount:500000',
      'amount:5000',
      'amount:50000',
    ]);
  });

  it('reads a figure after an ellipsis, a bare comma or last digits with a comma', () => {
    expect(
      numberAtoms(
        'Recibirás…5000 de vuelta, te devolvemos,2000 y con final 4321,500',
      ),
    ).toEqual(['amount:500000', 'amount:200000', 'last4:4321', 'amount:50000']);
    expect(numberAtoms('Recibirás…5,000 de vuelta')).toEqual(['amount:500000']);
  });

  it('reads a figure before a singular word that is also a verb', () => {
    expect(
      numberAtoms(
        'Tu cargo de 1500 pasó a revisión. El de 899 cuenta como aclarado.',
      ),
    ).toEqual(['amount:150000', 'amount:89900']);
  });

  it('reads digits of other scripts', () => {
    expect(numberAtoms('Recibirás $٥٠٠٠ de vuelta')).toEqual(['amount:500000']);
  });

  it('reads a numeral it cannot value as unread', () => {
    expect(numberAtoms('Te devolvemos ❺⓿⓿⓿ pesos')).toEqual(['unread']);
  });
});

describe('numberAtoms, thousands and decimals', () => {
  it('reads "$N mil" and a dot as thousands separator', () => {
    expect(numberAtoms('$5 mil pesos, $5 mil y $5.000')).toEqual([
      'amount:500000',
      'amount:500000',
      'amount:500000',
    ]);
  });

  it('reads a dot or "mil" as thousands without a currency word', () => {
    expect(numberAtoms('Recibirás 5.000 de vuelta o 5 mil de vuelta')).toEqual([
      'amount:500000',
      'amount:500000',
    ]);
  });

  it('reads a space as thousands separator, plain or no-break', () => {
    expect(
      numberAtoms('Recibirás 50 000 de vuelta, o 50\u202f000, o $50 000'),
    ).toEqual(['amount:5000000', 'amount:5000000', 'amount:5000000']);
  });

  it('reads a comma before one or two digits as decimal', () => {
    expect(
      numberAtoms('un cargo de $1.299,50, otro de 1,5 mil pesos y 3,5%'),
    ).toEqual(['amount:129950', 'amount:150000', 'pct:3.5']);
  });

  it('reads grouped centavos and a decimal with no leading zero', () => {
    expect(
      numberAtoms('1.500 centavos, .5%, $.50, .5 mil y …50 pesos'),
    ).toEqual([
      'amount:1500',
      'pct:0.5',
      'amount:50',
      'amount:50000',
      'amount:5000',
    ]);
  });

  it('reads a decimal with a leading comma', () => {
    expect(numberAtoms('una tasa de ,5% y ,50 pesos')).toEqual([
      'pct:0.5',
      'amount:50',
    ]);
  });

  it('reads a leading-comma decimal only after a space, a mark or the start', () => {
    expect(numberAtoms('20%,30% y (,5%)')).toEqual([
      'pct:20',
      'pct:30',
      'pct:0.5',
    ]);
  });

  it('reads a bare decimal after any mark but a letter, digit or percent', () => {
    expect(numberAtoms('-.5% y ".5%" o **.5%**')).toEqual([
      'pct:0.5',
      'pct:0.5',
      'pct:0.5',
    ]);
  });
});

describe('numberAtoms, what is not a figure', () => {
  it('ignores placeholders, counts and ids', () => {
    expect(
      numberAtoms(
        'Hola {{nombre}}, tus 3 cargos de tx_c001 vencen el {{fecha_limite_abono}}',
      ),
    ).toEqual([]);
  });

  it('leaves system ids alone', () => {
    expect(numberAtoms('tu cargo tx_c001 del caso case_k7q3')).toEqual([]);
  });

  it('leaves a figure before a listed count noun or an ordinal ending alone', () => {
    expect(
      numberAtoms(
        '3 cargos, 2 movimientos, 4 dígitos, 1 vez, 5 veces, 3er intento y la 2a compra',
      ),
    ).toEqual([]);
  });

  it('reads more count nouns and never a count as a time', () => {
    expect(
      numberAtoms(
        'Identificamos 2 cobros duplicados y 3 abonos; respecto a las 2 compras',
      ),
    ).toEqual([]);
  });

  it('leaves "un" and "una" alone unless a currency or unit claims them', () => {
    expect(
      numberAtoms(
        'En un momento revisamos una aclaración de uno de tus cargos.',
      ),
    ).toEqual([]);
    expect(numberAtoms('un peso en un día hábil, o 1.50')).toEqual([
      'amount:100',
      'dur:1:dia:habil',
      'amount:150',
    ]);
  });

  it('never joins the article "un" with the figure after it', () => {
    expect(numberAtoms('Te devolvemos un 100% del cargo')).toEqual(['pct:100']);
  });

  it('leaves "mil" alone only before a courtesy noun', () => {
    expect(numberAtoms('¡Mil gracias por tu paciencia!')).toEqual([]);
    expect(numberAtoms('Mil disculpas por la espera.')).toEqual([]);
    expect(numberAtoms('cinco mil de vuelta')).toEqual(['amount:500000']);
  });

  it('reads a lone "mil" in an amount slot as one thousand', () => {
    expect(numberAtoms('Recibirás mil de vuelta.')).toEqual(['amount:100000']);
    expect(numberAtoms('Tu cargo fue de mil y ya quedó.')).toEqual([
      'amount:100000',
    ]);
    expect(numberAtoms('un reembolso de $mil')).toEqual(['amount:100000']);
  });

  it('reads a bare "mil" before a currency word as one thousand', () => {
    expect(numberAtoms('un cargo de mil pesos')).toEqual(['amount:100000']);
  });
});

describe('numberAtoms, scale words', () => {
  it('reads millions as amounts', () => {
    expect(numberAtoms('un millón de pesos o 2.5 millones')).toEqual([
      'amount:100000000',
      'amount:250000000',
    ]);
    expect(numberAtoms('un millón doscientos mil pesos')).toEqual([
      'amount:120000000',
    ]);
  });

  it('reads millions at any scale, and a bare "millones" as unreadable', () => {
    expect(
      numberAtoms(
        'mil millones, 5 mil millones, medio millón, 5 mdp, 5k, $5 millones, MXN 2 mil, millones',
      ),
    ).toEqual([
      'amount:100000000000',
      'amount:500000000000',
      'amount:50000000',
      'amount:500000000',
      'amount:500000',
      'amount:500000000',
      'amount:200000',
      'unread',
    ]);
    expect(numberAtoms('$5k o MXN 2k')).toEqual([
      'amount:500000',
      'amount:200000',
    ]);
  });

  it('reads a bare "mdp" as unread and a dotted remainder after a million', () => {
    expect(numberAtoms('unos mdp, 1 millón 200.000 pesos')).toEqual([
      'unread',
      'amount:120000000',
    ]);
  });

  it('scales the remainder after a million by "mil"', () => {
    expect(numberAtoms('1 millón 200 mil pesos y 2 millones 500 mil')).toEqual([
      'amount:120000000',
      'amount:250000000',
    ]);
  });

  it('reads a currency-marked million with its remainder as one amount', () => {
    expect(numberAtoms('$1 millón 200 mil y MXN 1 millón 200 mil')).toEqual([
      'amount:120000000',
      'amount:120000000',
    ]);
  });

  it('reads "un millón y doscientos mil" as one amount', () => {
    expect(numberAtoms('un millón y doscientos mil pesos')).toEqual([
      'amount:120000000',
    ]);
  });

  it('reads grouped thousands and decimals before "mil"', () => {
    expect(numberAtoms('2,500 mil pesos y 2.500 mil, o 1.5 mil')).toEqual([
      'amount:250000000',
      'amount:250000000',
      'amount:150000',
    ]);
  });

  it('reads space-grouped thousands before a scale, a unit or a percent', () => {
    expect(
      numberAtoms('2 500 mil pesos, 2 500k, 2 500 mdp, 2 500 días, 1 000%'),
    ).toEqual([
      'amount:250000000',
      'amount:250000000',
      'amount:250000000000',
      'dur:2500:dia',
      'pct:1000',
    ]);
  });

  it('never reads "1.000 días" as one day nor "2.500 millones" as 2.5 million', () => {
    expect(numberAtoms('1.000 días hábiles y 2.500 millones')).toEqual([
      'dur:1000:dia:habil',
      'amount:250000000000',
    ]);
  });
});

describe('numberAtoms, figures spelled out', () => {
  it('reads numbers spelled out in Spanish', () => {
    expect(
      numberAtoms(
        'cinco mil pesos, dos mil quinientos pesos, tres días hábiles, un día hábil, veinticuatro horas y cuarenta y cinco días naturales',
      ),
    ).toEqual([
      'amount:500000',
      'amount:250000',
      'dur:3:dia:habil',
      'dur:1:dia:habil',
      'dur:24:hora',
      'dur:45:dia:natural',
    ]);
  });

  it('joins "y" when the right word is below the left one\'s lowest place', () => {
    expect(
      numberAtoms(
        'ciento y cinco pesos, mil y quinientos pesos, veinte y cinco días hábiles',
      ),
    ).toEqual(['amount:10500', 'amount:150000', 'dur:25:dia:habil']);
    expect(
      numberAtoms('treinta y cinco mil pesos o dos mil y tres pesos'),
    ).toEqual(['amount:3500000', 'amount:200300']);
  });

  it('keeps "y" apart between figures of the same place', () => {
    expect(
      numberAtoms(
        'entre treinta y cinco y cuarenta días; cien y doscientos pesos',
      ),
    ).toEqual(['dur:35:dia', 'dur:40:dia', 'amount:10000', 'amount:20000']);
  });

  it('never joins two figures that each carry "mil"', () => {
    expect(
      numberAtoms('dos mil y tres mil pesos, veinte mil y cinco mil'),
    ).toEqual([
      'amount:200000',
      'amount:300000',
      'amount:2000000',
      'amount:500000',
    ]);
  });

  it('keeps a spelled-out range apart, and joins a tens word and its unit', () => {
    expect(numberAtoms('entre dos y tres días hábiles')).toEqual([
      'dur:2:dia:habil',
      'dur:3:dia:habil',
    ]);
    expect(numberAtoms('treinta y cinco pesos')).toEqual(['amount:3500']);
  });
});

describe('numberAtoms, halves', () => {
  it('reads "y medio" after a figure as a figure nothing grounds', () => {
    expect(
      numberAtoms(
        'un millón y medio de pesos, $2 millones y medio, una hora y media',
      ),
    ).toEqual(['unread', 'unread', 'unread']);
  });

  it('reads a half after a space-grouped figure as unread', () => {
    expect(
      numberAtoms(
        '2 500 pesos y medio, 1 500 horas y media, $2 500 millones y medio',
      ),
    ).toEqual(['unread', 'unread', 'unread']);
    expect(numberAtoms('a las 2 500 mil y medio')).toEqual(['unread']);
  });

  it('reads a half after "a la(s)" with words before it as unread', () => {
    expect(numberAtoms('a las 2 mil y medio, a la 1 hora y media')).toEqual([
      'unread',
      'unread',
    ]);
  });

  it('reads a currency-marked half after "a las" as unread', () => {
    expect(numberAtoms('a las $2 500 y medio')).toEqual(['unread']);
  });

  it('reads a grouped or decimal figure "y medio" after "a las" as unread', () => {
    expect(numberAtoms('a las 2 500 y medio, a las 1.000 y medio')).toEqual([
      'unread',
      'unread',
    ]);
  });

  it('reads a figure past the last hour "y media" after "a las" as unread', () => {
    expect(numberAtoms('a las 25 y media, a las 500 y medio')).toEqual([
      'unread',
      'unread',
    ]);
  });

  it('reads the last hour "y media" after "a las" as a time', () => {
    expect(numberAtoms('a las 23 y media')).toEqual(['time:23:30']);
  });

  it('reads "media hora" and "medio día" as unread, and decimal durations', () => {
    expect(numberAtoms('media hora, medio día o 1.5 horas')).toEqual([
      'unread',
      'unread',
      'dur:1.5:hora',
    ]);
  });
});

describe('numberAtoms, percentages and durations', () => {
  it('reads percentages and durations with their qualifier', () => {
    expect(numberAtoms('una comisión de 3.5% o 2 por ciento')).toEqual([
      'pct:3.5',
      'pct:2',
    ]);
    expect(
      numberAtoms('en 24 horas, 45 días naturales o 2 días hábiles'),
    ).toEqual(['dur:24:hora', 'dur:45:dia:natural', 'dur:2:dia:habil']);
  });

  it('reads short hour units and singular qualifiers', () => {
    expect(numberAtoms('en 48h, en 72 hrs o en 1 día hábil')).toEqual([
      'dur:48:hora',
      'dur:72:hora',
      'dur:1:dia:habil',
    ]);
  });

  it('reads through repeated spaces and line breaks', () => {
    expect(numberAtoms('en 5  días, el 15  de marzo, en 3\n horas')).toEqual([
      'dur:5:dia',
      'date:--03-15',
      'dur:3:hora',
    ]);
  });

  it('reads grouped thousands before a unit or a percent', () => {
    expect(numberAtoms('dos mil quinientos días, 1.000% o 3.5%')).toEqual([
      'dur:2500:dia',
      'pct:1000',
      'pct:3.5',
    ]);
  });

  it('reads both ends of a duration range', () => {
    expect(
      numberAtoms('entre 2 y 3 días hábiles, de 1 a 2 semanas, 2-3 horas'),
    ).toEqual([
      'dur:2:dia:habil',
      'dur:3:dia:habil',
      'dur:1:semana',
      'dur:2:semana',
      'dur:2:hora',
      'dur:3:hora',
    ]);
  });

  it('reads a range with an en or em dash', () => {
    expect(numberAtoms('2–3 días y 4—5 horas')).toEqual([
      'dur:2:dia',
      'dur:3:dia',
      'dur:4:hora',
      'dur:5:hora',
    ]);
  });

  it('reads a range only after "de" or "entre" or with a dash, lower end first', () => {
    expect(
      numberAtoms(
        'te devolvemos 500 a 3 días; el abono es 10 y 45 días hábiles; de 5 a 3 días',
      ),
    ).toEqual([
      'amount:50000',
      'dur:3:dia',
      'amount:1000',
      'dur:45:dia:habil',
      'amount:500',
      'dur:3:dia',
    ]);
  });

  it('reads grouped and decimal ends of a range', () => {
    expect(numberAtoms('de 1.000 a 2.000 días, entre 1.5 y 2 horas')).toEqual([
      'dur:1000:dia',
      'dur:2000:dia',
      'dur:1.5:hora',
      'dur:2:hora',
    ]);
  });
});

describe('numberAtoms, dates', () => {
  it('reads dates written in Spanish, with slashes or ISO', () => {
    expect(
      numberAtoms(
        'el 5 de octubre, el 6 de octubre de 2026, 07/10/2026 y 2026-10-08',
      ),
    ).toEqual([
      'date:--10-05',
      'date:2026-10-06',
      'date:2026-10-07',
      'date:2026-10-08',
    ]);
  });

  it('reads dates with a two-digit year, dashes or no year', () => {
    expect(numberAtoms('el 15/03/26, el 15-03-2026 y el 15/03')).toEqual([
      'date:2026-03-15',
      'date:2026-03-15',
      'date:--03-15',
    ]);
  });

  it('reads day-month dates without "de", month first or with an ordinal', () => {
    expect(
      numberAtoms('el 15 marzo, marzo 16, el 1° de marzo y el 2o de abril'),
    ).toEqual(['date:--03-15', 'date:--03-16', 'date:--03-01', 'date:--04-02']);
  });

  it('keeps a year spelled out inside a date', () => {
    expect(numberAtoms('el 5 de octubre de dos mil veintiséis')).toEqual([
      'date:2026-10-05',
    ]);
  });

  it('reads an amount after a date as an amount, not a year', () => {
    expect(numberAtoms('Tu cargo del 5 de octubre, 1,299.50')).toEqual([
      'date:--10-05',
      'amount:129950',
    ]);
  });

  it('never lets a date take a figure that a scale, currency or percent follows', () => {
    expect(
      numberAtoms(
        'Recibirás 5-10 mil pesos; en octubre 5 mil pesos; te cobramos 5-10%; el 5 de octubre, 2026 pesos',
      ),
    ).toEqual([
      'amount:500',
      'amount:1000000',
      'amount:500000',
      'amount:500',
      'pct:10',
      'date:--10-05',
      'amount:202600',
    ]);
  });

  it('never lets a date take a figure that a unit follows', () => {
    expect(numberAtoms('5-3 días')).toEqual(['amount:500', 'dur:3:dia']);
  });

  it('never lets a date take the leading digits of a grouped or decimal figure', () => {
    expect(
      numberAtoms('octubre 5.500 pesos; octubre 5 500 pesos; 5/10.500 pesos'),
    ).toEqual([
      'amount:550000',
      'amount:550000',
      'amount:500',
      'amount:1050000',
    ]);
  });

  it('never lets a date take a grouped year that another group follows', () => {
    expect(numberAtoms('el 5 de octubre de 2,026 500 pesos')).toEqual([
      'date:--10-05',
      'amount:202650000',
    ]);
  });

  it('never lets an ISO date take a figure that a scale or currency follows', () => {
    expect(numberAtoms('2026-10-15 mil pesos')).toEqual([
      'amount:202600',
      'amount:1000',
      'amount:1500000',
    ]);
  });
});

describe('numberAtoms, years', () => {
  it('reads a year only after a year cue, spelled out too', () => {
    expect(
      numberAtoms(
        'el año 2026, durante 1999, este 2027, del año dos mil veintiséis',
      ),
    ).toEqual(['year:2026', 'year:1999', 'year:2027', 'year:2026']);
  });

  it('reads a figure after a preposition as an amount, never a year', () => {
    expect(
      numberAtoms('un cargo de 2026, hasta 2026, en 2026, para 2026'),
    ).toEqual([
      'amount:202600',
      'amount:202600',
      'amount:202600',
      'amount:202600',
    ]);
  });

  it('reads a figure with cents after a year cue as an amount', () => {
    expect(numberAtoms('durante 1999,50 y este 2026.50')).toEqual([
      'amount:199950',
      'amount:202650',
    ]);
  });

  it('reads a spelled-out year before 2000', () => {
    expect(numberAtoms('año mil novecientos noventa y nueve')).toEqual([
      'year:1999',
    ]);
  });
});

describe('numberAtoms, times', () => {
  it('reads hh:mm as a time', () => {
    expect(numberAtoms('a las 14:30 y a las 9:05')).toEqual([
      'time:14:30',
      'time:09:05',
    ]);
  });

  it('reads a time with a.m. or p.m., or after "a la(s)"', () => {
    expect(numberAtoms('a las 9 pm, a la 1, 12 am, 12 pm y 7:15 a.m.')).toEqual(
      ['time:21:00', 'time:01:00', 'time:00:00', 'time:12:00', 'time:07:15'],
    );
  });

  it('reads an afternoon hour and a dotted time after "a las"', () => {
    expect(
      numberAtoms('a las 3 de la tarde, a las 8 de la noche y a las 14.30'),
    ).toEqual(['time:15:00', 'time:20:00', 'time:14:30']);
  });

  it('reads midnight and noon after "a las"', () => {
    expect(numberAtoms('a las 12 de la noche y a las 12 de la tarde')).toEqual([
      'time:00:00',
      'time:12:00',
    ]);
  });

  it('reads early hours "de la noche" as a.m. and later ones as p.m.', () => {
    expect(numberAtoms('a las 1 de la noche y a las 11 de la noche')).toEqual([
      'time:01:00',
      'time:23:00',
    ]);
  });

  it('reads 5 "de la noche" as a.m. and 6 as p.m.', () => {
    expect(numberAtoms('a las 5 de la noche y a las 6 de la noche')).toEqual([
      'time:05:00',
      'time:18:00',
    ]);
  });

  it('reads "de la mañana" and "de la madrugada" as a.m.', () => {
    expect(
      numberAtoms('a las 9 y 30 de la mañana y a las 3 de la madrugada'),
    ).toEqual(['time:09:30', 'time:03:00']);
  });

  it('reads "y media", "y cuarto" and "y N" after "a las" as minutes', () => {
    expect(
      numberAtoms('a las tres y media, a las diez y cinco, a las 4 y cuarto'),
    ).toEqual(['time:03:30', 'time:10:05', 'time:04:15']);
  });

  it('reads "y N" as minutes only before punctuation or the end', () => {
    expect(
      numberAtoms(
        'a las 3 y 50 pesos, a las 3 y 50 mil, a las 3 y 20%, a las 3 y 15 días, a las 3 y 45.',
      ),
    ).toEqual([
      'time:03:00',
      'amount:5000',
      'time:03:00',
      'amount:5000000',
      'time:03:00',
      'pct:20',
      'time:03:00',
      'dur:15:dia',
      'time:03:45',
    ]);
  });

  it('reads minutes before "de la" only for a part of the day', () => {
    expect(numberAtoms('a las 3 y 50 de la comisión')).toEqual([
      'time:03:00',
      'amount:5000',
    ]);
  });

  it('joins "y" after "a la(s)" unless it reads as an hour and minutes', () => {
    expect(
      numberAtoms(
        'a las mil y quinientos pesos, a las veinte y cinco mil pesos',
      ),
    ).toEqual(['amount:150000', 'amount:2500000']);
  });

  it('never reads a figure with decimals or thousands after "a las" as a time', () => {
    expect(numberAtoms('a las 5.000 y a las 2.5')).toEqual([
      'amount:500000',
      'amount:250',
    ]);
  });

  it('never reads a space-grouped figure after "a las" as a time', () => {
    expect(numberAtoms('a las 5 500')).toEqual(['amount:550000']);
  });

  it('never reads a figure that a scale or currency follows as a time', () => {
    expect(numberAtoms('a las 14:30 mil pesos; 9:05 pesos')).toEqual([
      'amount:1400',
      'amount:3000000',
      'amount:900',
      'amount:500',
    ]);
  });

  it('reads a time that a unit follows as a time', () => {
    expect(numberAtoms('a las 14:30 hrs y 9:05 hrs')).toEqual([
      'time:14:30',
      'time:09:05',
    ]);
  });

  it('reads spelled-out minutes after "a las" only before punctuation or the end', () => {
    expect(
      numberAtoms('a las veinte y cinco pesos, a las diez y cinco.'),
    ).toEqual(['time:20:00', 'amount:500', 'time:10:05']);
  });

  it('joins spelled-out minutes after the hour as usual', () => {
    expect(
      numberAtoms('a las ocho y veinte y cinco. a las ocho y diez y seis.'),
    ).toEqual(['time:08:25', 'time:08:16']);
  });

  it('never joins a spelled-out hour and minutes after "a las" into one hour', () => {
    expect(numberAtoms('a las diez y cinco del 6 de octubre')).toEqual([
      'time:10:00',
      'amount:500',
      'date:--10-06',
    ]);
  });
});

describe('numberAtoms, card and key digits', () => {
  it('reads last digits as their own kind and leaves counts alone', () => {
    expect(numberAtoms('tus 3 cargos, la tarjeta que termina en 4321')).toEqual(
      ['last4:4321'],
    );
  });

  it('reads the last digits of a card after any cue, never as amounts', () => {
    expect(
      numberAtoms(
        'la tarjeta con terminación 4321, terminación en 6666, terminada en 8765, con final 1111, ****2222, XXXX5555 o •••• 3333, últimos 4 dígitos 4444',
      ),
    ).toEqual([
      'last4:4321',
      'last4:6666',
      'last4:8765',
      'last4:1111',
      'last4:2222',
      'last4:5555',
      'last4:3333',
      'last4:4444',
    ]);
  });

  it('reads any figure after a last-digits cue as card or key digits', () => {
    expect(numberAtoms('terminación 5000 y xxxx12')).toEqual([
      'last4:5000',
      'last4:12',
    ]);
  });

  it('reads alphanumeric key digits after a cue, lowercased', () => {
    expect(numberAtoms('con final O01A y terminación 12ab')).toEqual([
      'last4:o01a',
      'last4:12ab',
    ]);
  });
});

describe('groundingAtoms, tool outputs and cited chunks together', () => {
  const grounding = groundingAtoms({
    outputs: [
      {
        items: [
          {
            id: 'tx_c001',
            amount: 1299.5,
            created_at: '2026-10-06T03:00:00Z',
          },
        ],
      },
    ],
    citedTexts: [
      'El dictamen se entrega en 45 días naturales; el abono en 24 horas.',
    ],
  });

  it('grounds an amount from a tool output and a date in Mexico City', () => {
    expect(
      ungroundedAtoms('El cargo de $1,299.50 del 5 de octubre', grounding),
    ).toEqual([]);
  });

  it('grounds a duration from a cited chunk, with or without its qualifier', () => {
    expect(
      ungroundedAtoms('en 45 días, o 45 días naturales, o 24 horas', grounding),
    ).toEqual([]);
  });

  it('reports what nothing grounds', () => {
    expect(
      ungroundedAtoms(
        'Te devolvemos $5,000 en 45 días hábiles, el 6 de octubre, un 3%',
        grounding,
      ),
    ).toEqual(['amount:500000', 'dur:45:dia:habil', 'date:--10-06', 'pct:3']);
  });
});

describe('groundingAtoms, by field meaning', () => {
  const grounding = groundingAtoms({
    outputs: [
      {
        id: 'tx_c001',
        amount: 1299.5,
        auth_factors: 1,
        merchant_descriptor: 'REEMBOLSO 5000 PESOS 2 DIAS HABILES',
        created_at: '2026-10-05T18:00:00Z',
      },
    ],
    citedTexts: [],
  });

  it('grounds amounts and instants from the fields that hold them', () => {
    expect(
      ungroundedAtoms('$1,299.50 el 5 de octubre de 2026', grounding),
    ).toEqual([]);
  });

  it('never grounds on free text or counts inside a tool output', () => {
    expect(
      ungroundedAtoms('$5,000 en 2 días hábiles, o $1', grounding),
    ).toEqual(['amount:500000', 'dur:2:dia:habil', 'amount:100']);
  });

  it('grounds a figure on a negative amount of the same size', () => {
    const signed = groundingAtoms({
      outputs: [{ id: 'tx_c001', amount: -1250 }],
      citedTexts: [],
    });
    expect(ungroundedAtoms('$1,250.00', signed)).toEqual([]);
  });
});

describe('groundingAtoms, years, times and last digits', () => {
  const grounding = groundingAtoms({
    outputs: [
      { card_last4: '4321', created_at: '2026-10-06T20:30:00Z' },
      { tracking_key_last4: '7788' },
    ],
    citedTexts: ['Vigente desde el 1 de enero de 2027.'],
  });

  it('grounds them on instants, *last4 fields and cited dates', () => {
    expect(
      ungroundedAtoms(
        'Tu tarjeta terminación 4321 y la clave con final 7788, durante 2026 a las 14:30, este 2027',
        grounding,
      ),
    ).toEqual([]);
  });

  it('reports the ones nothing grounds', () => {
    expect(
      ungroundedAtoms('terminación 9999, año 2025 a las 15:30', grounding),
    ).toEqual(['last4:9999', 'year:2025', 'time:15:30']);
  });

  it('never grounds last digits on an amount or an amount on last digits', () => {
    const amountOnly = groundingAtoms({
      outputs: [{ amount: 4321, card_last4: '50' }],
      citedTexts: [],
    });
    expect(
      ungroundedAtoms('terminación 4321, te devolvemos 50', amountOnly),
    ).toEqual(['last4:4321', 'amount:5000']);
  });

  it('grounds a masked CLABE field and an alphanumeric *last4 field', () => {
    const masked = groundingAtoms({
      outputs: [
        { counterparty_clabe: 'CLABE ••••3213', tracking_key_last4: 'O01A' },
      ],
      citedTexts: [],
    });
    expect(
      ungroundedAtoms('a la CLABE ••••3213, clave con final O01A', masked),
    ).toEqual([]);
    expect(ungroundedAtoms('con final O02A', masked)).toEqual(['last4:o02a']);
  });
});

describe('groundingAtoms, cited chunks', () => {
  it('never grounds a bare figure or last digits on a cited chunk', () => {
    const grounding = groundingAtoms({
      outputs: [],
      citedTexts: [
        'Conforme al artículo 23 de la LTOSF y la Circular 14/2017, vigente desde 2025, con final 4321.',
      ],
    });
    expect(
      ungroundedAtoms(
        'Te devolvemos 23, recibirás 2017, 2025 y terminación 4321',
        grounding,
      ),
    ).toEqual(['amount:2300', 'amount:201700', 'amount:202500', 'last4:4321']);
  });

  describe('with scale words and ranges', () => {
    const grounding = groundingAtoms({
      outputs: [],
      citedTexts: [
        'Atendemos a millones de clientes, medio millón de casos, de 2 a 3 días hábiles.',
      ],
    });

    it('never grounds a bare "millones", but grounds "medio millón"', () => {
      expect(
        ungroundedAtoms('Recibirás millones o medio millón', grounding),
      ).toEqual(['unread']);
    });

    it('grounds both ends of a range a chunk states', () => {
      expect(
        ungroundedAtoms('Tarda entre 2 y 3 días hábiles.', grounding),
      ).toEqual([]);
    });
  });

  it('never grounds "un millón y medio" on a chunk that states one million', () => {
    const grounding = groundingAtoms({
      outputs: [],
      citedTexts: [
        'Puedes recibir hasta 1 millón de pesos, un millón y medio con aprobación, o esperar 1 hora.',
      ],
    });
    expect(
      ungroundedAtoms(
        'hasta un millón y medio de pesos, en una hora y media',
        grounding,
      ),
    ).toEqual(['unread', 'unread']);
  });

  it('never grounds the whole part of a half a chunk states', () => {
    const grounding = groundingAtoms({
      outputs: [],
      citedTexts: [
        'Tarda una hora y media o hasta un millón y medio de pesos.',
      ],
    });
    expect(
      ungroundedAtoms('Tarda 1 hora; hasta un millón de pesos.', grounding),
    ).toEqual(['dur:1:hora', 'amount:100000000']);
  });

  it('never grounds the whole part of a space-grouped half a chunk states', () => {
    const grounding = groundingAtoms({
      outputs: [],
      citedTexts: ['Tarda 1 500 horas y media.'],
    });
    expect(ungroundedAtoms('Tarda 1 500 horas.', grounding)).toEqual([
      'dur:1500:hora',
    ]);
  });

  it('never grounds the tail of a grouped figure a chunk states', () => {
    const grounding = groundingAtoms({
      outputs: [],
      citedTexts: [
        'Tarda 1.500 días hábiles o 1 500 días naturales; el tope es de 2,500 mil pesos.',
      ],
    });
    expect(
      ungroundedAtoms(
        '500 días hábiles, 500 días naturales y 500 mil pesos',
        grounding,
      ),
    ).toEqual(['dur:500:dia:habil', 'dur:500:dia:natural', 'amount:50000000']);
  });
});
