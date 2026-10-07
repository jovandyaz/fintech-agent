import { describe, expect, it } from 'vitest';

import { groundingAtoms, numberAtoms, ungroundedAtoms } from './numbers.js';

describe('numberAtoms', () => {
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

  it('reads percentages and durations with their qualifier', () => {
    expect(numberAtoms('una comisión de 3.5% o 2 por ciento')).toEqual([
      'pct:3.5',
      'pct:2',
    ]);
    expect(
      numberAtoms('en 24 horas, 45 días naturales o 2 días hábiles'),
    ).toEqual(['dur:24:hora', 'dur:45:dia:natural', 'dur:2:dia:habil']);
  });

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

  it('ignores placeholders, counts and ids', () => {
    expect(
      numberAtoms(
        'Hola {{nombre}}, tus 3 cargos de tx_c001 vencen el {{fecha_limite_abono}}',
      ),
    ).toEqual([]);
  });
});

describe('ungroundedAtoms', () => {
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

describe('numberAtoms, other written forms', () => {
  it('reads a currency mark before or after the figure', () => {
    expect(numberAtoms('MXN 5,000 o MXN 5000 o 5,000 M.N.')).toEqual([
      'amount:500000',
      'amount:500000',
      'amount:500000',
    ]);
    expect(numberAtoms('un cargo de $5,000 MXN')).toEqual(['amount:500000']);
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

  it('reads short hour units and singular qualifiers', () => {
    expect(numberAtoms('en 48h, en 72 hrs o en 1 día hábil')).toEqual([
      'dur:48:hora',
      'dur:72:hora',
      'dur:1:dia:habil',
    ]);
  });

  it('reads a bare "mil" before a currency word as one thousand', () => {
    expect(numberAtoms('un cargo de mil pesos')).toEqual(['amount:100000']);
  });

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
});

describe('numberAtoms, amounts without a currency word', () => {
  it('reads a figure with thousands, cents or five or more digits', () => {
    expect(
      numberAtoms('Recibirás 5,000 de vuelta, luego 1,299.50 y luego 12500'),
    ).toEqual(['amount:500000', 'amount:129950', 'amount:1250000']);
    expect(numberAtoms('Recibirás cinco mil de vuelta')).toEqual([
      'amount:500000',
    ]);
  });

  it('reads "$N mil" and a dot as thousands separator', () => {
    expect(numberAtoms('$5 mil pesos, $5 mil y $5.000')).toEqual([
      'amount:500000',
      'amount:500000',
      'amount:500000',
    ]);
  });

  it('leaves counts, last digits and years alone', () => {
    expect(
      numberAtoms('tus 3 cargos, la tarjeta que termina en 4321, durante 2026'),
    ).toEqual([]);
  });
});

describe('numberAtoms, thousands written other ways', () => {
  it('reads a dot or "mil" as thousands without a currency word', () => {
    expect(numberAtoms('Recibirás 5.000 de vuelta o 5 mil de vuelta')).toEqual([
      'amount:500000',
      'amount:500000',
    ]);
  });

  it('keeps a year spelled out inside a date', () => {
    expect(numberAtoms('el 5 de octubre de dos mil veintiséis')).toEqual([
      'date:2026-10-05',
    ]);
  });
});

describe('numberAtoms, spaced thousands and dates before amounts', () => {
  it('reads a space as thousands separator, plain or no-break', () => {
    expect(
      numberAtoms('Recibirás 50 000 de vuelta, o 50\u202f000, o $50 000'),
    ).toEqual(['amount:5000000', 'amount:5000000', 'amount:5000000']);
  });

  it('reads an amount after a date as an amount, not a year', () => {
    expect(numberAtoms('Tu cargo del 5 de octubre, 1,299.50')).toEqual([
      'date:--10-05',
      'amount:129950',
    ]);
  });
});

describe('numberAtoms, spacing', () => {
  it('reads through repeated spaces and line breaks', () => {
    expect(numberAtoms('en 5  días, el 15  de marzo, en 3\n horas')).toEqual([
      'dur:5:dia',
      'date:--03-15',
      'dur:3:hora',
    ]);
  });
});

describe('numberAtoms, "mil" as a courtesy', () => {
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
});

describe('numberAtoms, bare three- and four-digit figures', () => {
  it('reads them as amounts', () => {
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

  it('leaves years and the last digits of a card alone', () => {
    expect(
      numberAtoms(
        'durante 2026, la tarjeta con terminación 4321, terminación en 6666, terminada en 8765, con final 1111, ****2222, XXXX5555 o •••• 3333, últimos 4 dígitos 4444',
      ),
    ).toEqual([]);
  });
});

describe('groundingAtoms, signed amounts', () => {
  it('grounds a figure on a negative amount of the same size', () => {
    const grounding = groundingAtoms({
      outputs: [{ id: 'tx_c001', amount: -1250 }],
      citedTexts: [],
    });
    expect(ungroundedAtoms('$1,250.00', grounding)).toEqual([]);
  });
});
