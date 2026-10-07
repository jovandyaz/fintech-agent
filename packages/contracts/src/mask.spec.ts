import { describe, expect, it } from 'vitest';

import { hasPii, maskJson, maskPii, visibleTailOf } from './mask.js';

const CLABE = '012180001234567899';
const CLABE_PASSING_LUHN = '012180001234500267';
const CLABE_VALID_SECOND = '032180000118359719';
const CLABE_BAD_CONTROL = '032180000118359710';
const VISA = '4111111111111111';
const VISA_FAILING_LUHN = '4111111111111112';
const VISA_BASE64 = 'NDExMTExMTExMTExMTExMQ==';
const AMEX = '378282246310005';
const NBSP = ' ';
const NARROW_NBSP = ' ';
const ZWSP = '\u200b';
const MAX_MASK_MS_FOR_32KB = 250;
const TIMED_RUNS = 3;
const SEPARATORS = /[^\d\p{L}•]/gu;
const EIGHT_DIGITS = /\d{8}/;

const expectNoLongDigitRun = (masked: string): void => {
  expect(masked.replace(SEPARATORS, '')).not.toMatch(EIGHT_DIGITS);
};

describe('maskPii — CLABE', () => {
  it('masks an 18-digit CLABE keeping the last four', () => {
    expect(maskPii(`Mi CLABE es ${CLABE}`)).toBe('Mi CLABE es CLABE ••••7899');
  });

  it('masks a CLABE written in groups with spaces or dashes', () => {
    expect(maskPii('0121 8000 1234 5678 99')).toBe('CLABE ••••7899');
    expect(maskPii('012-180-001234567899')).toBe('CLABE ••••7899');
  });

  it('treats 18 digits as a CLABE even when they pass Luhn', () => {
    expect(maskPii(CLABE_PASSING_LUHN)).toBe('CLABE ••••0267');
  });

  it('does not let a preceding date swallow a CLABE', () => {
    expect(maskPii(`2026-10-05 ${CLABE}`)).toBe('2026-10-05 CLABE ••••7899');
  });

  it.each([
    ['dots', '012.180.001234567899'],
    ['slashes', '012/180/00123456789/9'],
    ['double spaces', '012  180  001234567899'],
    ['a line break', '012180\n001234567899'],
    ['tabs', '0121\t8000\t1234\t5678\t99'],
    ['no-break spaces', `0121${NBSP}8000${NBSP}1234${NBSP}5678${NBSP}99`],
    [
      'narrow no-break spaces',
      `0121${NARROW_NBSP}8000${NARROW_NBSP}1234${NARROW_NBSP}5678${NARROW_NBSP}99`,
    ],
    ['full-width digits', '０１２１８０００１２３４５６７８９９'],
  ])('masks a CLABE written with %s', (_, text) => {
    expect(maskPii(text)).toBe('CLABE ••••7899');
  });

  it('masks a CLABE glued to a word without repeating the label', () => {
    expect(maskPii(`clabe${CLABE}`)).toBe('CLABE ••••7899');
  });

  it('does not repeat a label the customer already wrote', () => {
    expect(maskPii(`CLABE ${CLABE_VALID_SECOND}`)).toBe('CLABE ••••9719');
  });
});

describe('maskPii — card numbers', () => {
  it('masks a Luhn-valid card number keeping the last four', () => {
    expect(maskPii(`tarjeta ${VISA}`)).toBe('tarjeta ••••1111');
    expect(maskPii(AMEX)).toBe('tarjeta ••••0005');
  });

  it('masks a card number written in groups', () => {
    expect(maskPii('4111 1111 1111 1111')).toBe('tarjeta ••••1111');
    expect(maskPii('4111-1111-1111-1111')).toBe('tarjeta ••••1111');
  });

  it('masks 16 digits that fail Luhn as a number', () => {
    expect(maskPii(`referencia ${VISA_FAILING_LUHN}`)).toBe(
      'referencia núm ••••1112',
    );
  });

  it.each([
    ['dots', '4111.1111.1111.1111'],
    ['underscores', '4111_1111_1111_1111'],
    ['no-break spaces', `4111${NBSP}1111${NBSP}1111${NBSP}1111`],
    ['full-width digits', '４１１１１１１１１１１１１１１１'],
    [
      'narrow no-break spaces',
      `4111${NARROW_NBSP}1111${NARROW_NBSP}1111${NARROW_NBSP}1111`,
    ],
  ])('masks a card number written with %s', (_, text) => {
    expect(maskPii(text)).toBe('tarjeta ••••1111');
  });

  it('masks a card number glued to a word', () => {
    expect(maskPii(`tarjeta${VISA}`)).toBe('tarjeta ••••1111');
  });

  it('masks an Amex number in 4-6-5 groups', () => {
    expect(maskPii('3782 822463 10005')).toBe('tarjeta ••••0005');
  });

  it('masks the expiry date that follows a card number', () => {
    expect(maskPii('4111 1111 1111 1111 12 28')).toBe('tarjeta ••••1111 •• ••');
  });
});

describe('maskPii — fail-closed numbers', () => {
  it('masks a CLABE whose control digit is wrong', () => {
    expect(maskPii(`CLABE ${CLABE_BAD_CONTROL}`)).toBe('CLABE núm ••••9710');
  });

  it('masks a phone written in pairs', () => {
    expect(maskPii('mi tel 55 12 34 56 78')).toBe('mi tel ••••5678');
  });

  it.each([
    ['5-5-6 groups', '41111 11111 111111'],
    ['single digits', '4 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1'],
    ['4-2-2-4-4 groups, no BIN visible', '4111-11-11-1111-1111'],
    ['Arabic-Indic digits', '٤١١١١١١١١١١١١١١١'],
    ['zero-width separators', `4111${ZWSP}1111${ZWSP}1111${ZWSP}1111`],
    [
      'Spanish digit words',
      'cuatro uno uno uno uno uno uno uno uno uno uno uno uno uno uno uno',
    ],
  ])('masks a card number written as %s', (_, text) => {
    expect(maskPii(text)).toBe('tarjeta ••••1111');
  });

  it.each([
    ['mixed words and digits', 'cinco cinco 1 2 3 4 cinco seis siete ocho'],
    [
      'Spanish compounds',
      'cincuenta y cinco, doce, treinta y cuatro, cincuenta y seis, setenta y ocho',
    ],
  ])('masks a phone written as %s', (_, text) => {
    expect(maskPii(text)).toBe('tel ••••5678');
  });

  it('masks a CLABE written in Spanish digit words', () => {
    expect(
      maskPii(
        'cero uno dos uno ocho cero cero cero uno dos tres cuatro cinco seis siete ocho nueve nueve',
      ),
    ).toBe('CLABE ••••7899');
  });

  it.each([
    ['o and l confusables', '4111o1111l1111 1111'],
    ['a UUID shape made of digits', '12345678-1234-1234-1234-123456789012'],
    ['a registry prefix hiding a PAN', `tx_${VISA}`],
    ['a long order number', 'pedido 2026100500017'],
  ])('leaves no run of eight digits for %s', (_, text) => {
    expectNoLongDigitRun(maskPii(text));
  });

  it('masks digits interleaved with words through the density window', () => {
    expect(maskPii('4111 y 1111 y 1111 y 1111')).toBe(
      '•••• y •••• y •••• y ••••',
    );
  });

  it('masks digits grouped with commas through the density window', () => {
    expect(maskPii('4,111,111,111,111,111')).toBe('•,•••,•••,•••,•••,•••');
  });

  it('does not exempt an amount that continues into more digits', () => {
    expectNoLongDigitRun(maskPii('4111.11 1111 1111'));
    expect(maskPii('4111.11 1111 1111')).not.toContain('4111');
  });

  it('masks a base64-encoded card number', () => {
    expect(maskPii(`mi tarjeta ${VISA_BASE64}`)).toBe(
      'mi tarjeta ref ••••ExMQ',
    );
  });
});

describe('maskPii — identity documents', () => {
  it('masks an RFC for a person and for a company', () => {
    expect(maskPii('RFC: GODE561231GR8')).toBe('RFC ••••');
    expect(maskPii('la empresa ABC680524P76')).toBe('la empresa RFC ••••');
  });

  it('masks an RFC typed in lowercase', () => {
    expect(maskPii('mi rfc es gode561231gr8')).toBe('mi rfc es RFC ••••');
  });

  it('masks a CURP as a CURP, not as an RFC inside it', () => {
    expect(maskPii('CURP GODE561231HDFRRN09')).toBe('CURP ••••');
  });

  it.each([
    ['GODE 561231 GR8', 'RFC ••••'],
    ['GODE-561231-GR8', 'RFC ••••'],
    ['GODE 561231 HDFRRN 09', 'CURP ••••'],
    ['curpGODE561231HDFRRN09', 'CURP ••••'],
    ['rfcGODE561231GR8', 'RFC ••••'],
  ])('masks an identity document written as %s', (text, expected) => {
    expect(maskPii(text)).toBe(expected);
  });
});

describe('maskPii — contact data', () => {
  it('masks an email keeping the first letter and the domain', () => {
    expect(maskPii('escríbanme a juan.perez@gmail.com')).toBe(
      'escríbanme a j•••@gmail.com',
    );
  });

  it('masks an email whose local part has accents or ñ', () => {
    expect(maskPii('josé@correo.mx')).toBe('j•••@correo.mx');
    expect(maskPii('peña@correo.mx')).toBe('p•••@correo.mx');
  });

  it('masks a Mexican phone number with or without +52', () => {
    expect(maskPii('mi cel 5512345678')).toBe('mi cel tel ••••5678');
    expect(maskPii('llámenme al +52 55 1234 5678')).toBe(
      'llámenme al tel ••••5678',
    );
  });

  it.each([
    '55.1234.5678',
    '(55) 1234 5678',
    '55-1234-5678',
    '+52 (55) 1234 5678',
    '+52 1 55 1234 5678',
  ])('masks the phone format %s', (text) => {
    expect(maskPii(text)).toBe('tel ••••5678');
  });
});

describe('maskPii — authentication factors', () => {
  it('masks the digits after an auth-factor keyword', () => {
    expect(maskPii('mi NIP es 4321')).toBe('mi NIP es [factor]');
    expect(maskPii('el CVV: 123')).toBe('el CVV: [factor]');
    expect(maskPii('código de verificación 654321')).toBe(
      'código de verificación [factor]',
    );
    expect(maskPii('OTP 998877')).toBe('OTP [factor]');
  });

  it('does not treat a postal code as an auth factor', () => {
    expect(maskPii('código postal 06600')).toBe('código postal 06600');
  });

  it.each([
    ['CVV2 123', 'CVV2 [factor]'],
    ['NIP1234', 'NIP[factor]'],
    ['nip-1234', 'nip-[factor]'],
    ['nip #1234', 'nip #[factor]'],
    ['mi nip, 1234', 'mi nip, [factor]'],
    ['nip "1234"', 'nip "[factor]"'],
    ['mi nip sería 1234', 'mi nip sería [factor]'],
    ['el código que me llegó es 123456', 'el código que me llegó es [factor]'],
    ['token 12345678', 'token [factor]'],
    ['nip 12 34', 'nip [factor]'],
    ['mi clave es 1234', 'mi clave es [factor]'],
    ['password 1234', 'password [factor]'],
    ['el pin de mi tarjeta es 1234', 'el pin de mi tarjeta es [factor]'],
    ['código 123 456', 'código [factor]'],
    ['1234 es mi nip', '[factor] es mi nip'],
  ])('masks the auth factor in "%s"', (text, expected) => {
    expect(maskPii(text)).toBe(expected);
  });

  it('masks a SPEI tracking key as a number, not as an auth factor', () => {
    expect(maskPii('clave de rastreo MBAN01002510050012345678')).toBe(
      'clave de rastreo MBAN núm ••••5678',
    );
  });
});

describe('maskPii — system ids, dates, times and amounts stay intact', () => {
  it.each([
    '2026-10-05 10:30',
    '05/10/2026',
    'tx_0412',
    'tx_0412 y tx_0413 y tx_0414',
    'Mi folio es AC-K7Q3-M9X2',
    'La referencia numérica es 1234567',
    '$12,345.67 y $1,250.50',
    'Fecha y hora: 2026-10-05T14:22:10Z',
  ])('leaves %s unchanged', (text) => {
    expect(maskPii(text)).toBe(text);
  });
});

describe('maskPii — folios whose groups spell an auth keyword', () => {
  it.each([
    'AC-PWDW-8NYN',
    'AC-PASS-W0RD',
    'AC-8NYN-PWD4',
    'AC-CVV2-8NYN',
    'AC-SMS4-PASS',
    'AC-2FA3-MFA7',
    'AC-TKN5-CVC2',
  ])('keeps %s whole, alone and in a sentence', (folio) => {
    expect(maskPii(folio)).toBe(folio);
    expect(maskPii(`Tu folio es ${folio}.`)).toBe(`Tu folio es ${folio}.`);
  });

  it('still masks a password that follows a folio', () => {
    expect(maskPii('folio AC-PWDW-8NYN, pass: Xy9!abcd')).toBe(
      'folio AC-PWDW-8NYN, pass: [factor]',
    );
  });

  it.each([
    ['passHunter2!', 'Hunter2!'],
    ['pwdHunter2!', 'Hunter2!'],
    ['passwordXy9!', 'Xy9!'],
    ['contraseñaXy9!', 'Xy9!'],
    ['mi pwdW-8NYN', 'W-8NYN'],
  ])('masks a password glued to its keyword: %s', (text, secret) => {
    expect(maskPii(text)).not.toContain(secret);
  });

  it.each([
    ['el SMS para AC-KMQX-PDRT es 482193', '482193'],
    ['mi OTP de AC-KMQX-PDRT es 482193', '482193'],
    ['CVV de la tarjeta AC-KMQX-PDRT = 123', '= 123'],
    ['token AC-HJKM-NPQR, 99 1234', '99 1234'],
    ['AC-KMQX-PASS es 4821', '4821'],
  ])(
    'masks an auth factor with a folio between it and its keyword: %s',
    (text, secret) => {
      const masked = maskPii(text);
      expect(masked).not.toContain(secret);
      expect(masked).toMatch(/AC-[A-Z]{4}-[A-Z]{4}/);
    },
  );

  it.each([
    ['pass:Hunter2!,AC-7K2M-Q9XD', 'Hunter2!'],
    ['contraseña:Hunter2!/AC-7K2M-Q9XD', 'Hunter2!'],
    ['pwd=Xy9#abcd;AC-7K2M-Q9XD', 'Xy9#abcd'],
    ['pass:AC-KMQX-PDRT,Hunter2!', 'Hunter2!'],
    ['clave de acceso AC-KMQX-PDRT/xY9#', 'xY9#'],
    ['AC-KMQX-PDR1,4821 es mi NIP', '4821'],
    ['pass:!@#$AC-KMQX-PDRT', '!@#$'],
    ['pass:AC-KMQX-PDRT!@#$', '!@#$'],
  ])('masks a secret glued to a folio: %s', (text, secret) => {
    expect(maskPii(text)).not.toContain(secret);
  });

  it.each([
    ['pass:AC-KMQX-PDRT', 'KMQX-PDRT'],
    ['pass:AC-KMQX-PDRT,AC-HJKM-NPQR', 'HJKM-NPQR'],
    ['pass:AC-KMQX-PDRT.AC-HJKM-NPQR.AC-TVWX-YZ12', 'TVWX-YZ12'],
    ['AC-KMQX-P123 es mi CVV', 'P123'],
    ['AC-KMQX-P482 es mi NIP', 'P482'],
  ])(
    'masks a folio-shaped secret named by a keyword outside it: %s',
    (text, secret) => {
      expect(maskPii(text)).not.toContain(secret);
    },
  );
});

describe('maskPii — number-like ids that could hide personal data', () => {
  it.each([
    '08bc9b76-6326-4987-8f2a-1c2d3e4f5a6b',
    'rastreo 085904567890123456',
    '10 20 30 40 50 60 70 80 90',
    '192.168.1.1',
    'Folio de aclaración 2026100500017',
    'Mi folio es CC-2026-000123',
    'AC-4111-1111',
  ])('masks %s', (text) => {
    const masked = maskPii(text);
    expect(masked).not.toBe(text);
    expectNoLongDigitRun(masked);
  });
});

describe('maskPii — properties', () => {
  const mixed = `Soy GODE561231HDFRRN09, RFC GODE561231GR8, CLABE ${CLABE}, tarjeta 4111 1111 1111 1111, correo ana@albo.mx, tel +52 55 1234 5678 y mi NIP es 4321.`;

  it('masks every kind of personal data in one text', () => {
    const masked = maskPii(mixed);
    for (const leaked of [
      'GODE561231',
      CLABE,
      '4111 1111 1111',
      'ana@',
      '1234 5678',
      '4321',
    ]) {
      expect(masked).not.toContain(leaked);
    }
  });

  it('is idempotent', () => {
    const once = maskPii(mixed);
    expect(maskPii(once)).toBe(once);
  });

  it.each([
    mixed,
    '4111 y 1111 y 1111 y 1111',
    'núm ••••1234 y núm ••••5678 y núm ••••9012',
    `mi tarjeta ${VISA_BASE64}`,
    'cinco cinco 1 2 3 4 cinco seis siete ocho',
    '4111-11-11-1111-1111',
  ])('is idempotent on %s', (text) => {
    const once = maskPii(text);
    expect(maskPii(once)).toBe(once);
  });

  it.each([
    ['digit pairs', '1 '.repeat(16_000)],
    ['five-digit groups', '12345 '.repeat(5_400)],
    ['dashed pairs', '12-'.repeat(10_900)],
    ['one long digit run', '9'.repeat(32_000)],
    ['digit words', 'uno '.repeat(8_000)],
    ['interleaved digits', '4111 y '.repeat(4_500)],
    ['base64-looking tokens', `${VISA_BASE64} `.repeat(1_300)],
    ['many separate phone numbers', '5512345678 '.repeat(2_900)],
    ['repeated labels before one value', `${'tel '.repeat(7_000)}5512345678`],
    ['many typed bullets and digits', '•1 '.repeat(10_000)],
  ])('masks 32 KB of %s in linear time', (_, text) => {
    // The fastest of a few runs: parallel verify runs stall single samples,
    // but a superlinear regression is slow on every run.
    const fastest = Math.min(
      ...Array.from({ length: TIMED_RUNS }, () => {
        const start = performance.now();
        maskPii(text);
        return performance.now() - start;
      }),
    );
    expect(fastest).toBeLessThan(MAX_MASK_MS_FOR_32KB);
  });

  const benign = [
    'Hice una transferencia de $5,000.00 el 2026-10-05',
    'La referencia numérica es 1234567',
    'Pagué el 05/10/2026 a las 10:30 por $1,250.50',
    'El cargo fue a las 10:30 en OXXO',
    'Mi folio es AC-K7Q3-M9X2',
    'Transacción tx_0412 y tx_0413',
    'Pagué a 3 meses sin intereses',
    'El SPEI salió hace 2 horas',
    'Llevo 45 días esperando',
    'Tarjeta terminada en 1234',
    'La cuenta que termina en 5678',
    'Monto: 1,250.50 MXN',
    'Fecha y hora: 2026-10-05T14:22:10Z',
    'código postal 06600',
    'versión 2.3.1 de la app',
    'Abono de 18 pesos',
    'Compra en AMAZON MX por 499',
    'Saldo disponible 10,000',
    'Llamé al 800 que viene en la app',
    'ID de caso 7f3a9c',
    'Orden #4567890',
    'El año pasado, en 2025, no pasó esto',
    'Me cobraron tres veces 349.00 el 2026-10-04',
    'Me cobraron 2 veces 349.00',
    'La app dice error 503',
    'https://albo.mx/ayuda/spei',
    'Mi correo no lo voy a compartir',
    'Recibí un SMS con un link raro',
    'Contraseña olvidada',
    'NIP bloqueado',
    'token expirado ayer',
    'RFC pendiente de actualizar',
    'CURP no válida según el sistema',
    'Tasa de 3.5% anual',
    'Hora del intento: 23:59:59',
    'Me llegaron dos cargos de uno y de cinco pesos',
    'Electroencefalografista de profesión',
  ];

  it.each(benign)('leaves benign text unchanged: %s', (text) => {
    expect(maskPii(text)).toBe(text);
  });
});

describe('maskJson', () => {
  it('masks string values inside structured data, not the serialized text', () => {
    expect(
      maskJson({
        t: `mi clabe 012180\n001234567899`,
        nested: [{ email: 'ana@albo.mx' }],
        id: 'tx_0412',
        at: 1727000000000,
      }),
    ).toEqual({
      t: 'mi CLABE ••••7899',
      nested: [{ email: 'a•••@albo.mx' }],
      id: 'tx_0412',
      at: 1727000000000,
    });
  });

  it('masks auth-factor values by key, whether string or number', () => {
    expect(
      maskJson({ otp: '123456', pin: 4321, cvv: '123', nip: null }),
    ).toEqual({ otp: '[factor]', pin: '[factor]', cvv: '[factor]', nip: null });
  });

  it('leaves non-string leaves and keys untouched', () => {
    expect(maskJson([true, 3.5, null, { ok: false }])).toEqual([
      true,
      3.5,
      null,
      { ok: false },
    ]);
  });

  it('keeps registry and UUID ids under id keys and masks external ids', () => {
    expect(
      maskJson({
        case_id: 'case_ab12',
        run_id: '08bc9b76-6326-4987-8f2a-1c2d3e4f5a6b',
        ticket_id: `ZD-${VISA}`,
      }),
    ).toEqual({
      case_id: 'case_ab12',
      run_id: '08bc9b76-6326-4987-8f2a-1c2d3e4f5a6b',
      ticket_id: 'ZD-tarjeta ••••1111',
    });
  });

  it('masks long numbers unless the key is a timestamp', () => {
    expect(
      maskJson({ phone: 5512345678, amount: 349, created_at: 1727000000000 }),
    ).toEqual({
      phone: 'tel ••••5678',
      amount: 349,
      created_at: 1727000000000,
    });
  });
});

const MAX_DIGITS_SHOWN = 4;
const digitsLeft = (masked: string): number => masked.replace(/\D/g, '').length;
const KEYCAP = '️⃣';

describe('maskPii — attack review, round 3', () => {
  it.each([
    ['a typed mask tail followed by a phone', '••••5512345678'],
    ['one typed bullet before a phone', '•5512345678'],
    ['a typed mask tail before a grouped phone', '••••551234 5678'],
    ['a typed mask tail inside a sentence', 'mi cel ••••5512 345 678'],
    ['a typed mask tail before a card', '••••4111 1111 1111 1111'],
    ['amounts carrying a CLABE', '$411,111,111 $111,111,111'],
    ['amounts with cents carrying a card', '$4,111,111.11 $1,111,111.11'],
    ['a phone shaped as an amount', '55,123,456.78'],
    ['a phone shaped as a dollar amount', '$55,123,456.78'],
    ['two decimal amounts carrying a card', '4111111.11, 1111111.11'],
    ['three small amounts carrying a CLABE', '$411,111 $111,111 $111,111'],
    ['commas', '55,1234,5678'],
    ['semicolons', '55;1234;5678'],
    ['pipes', '55|1234|5678'],
    ['asterisks', '55*1234*5678'],
    ['middle dots', '55·1234·5678'],
    ['hashes', '55#1234#5678'],
    ['a comma per digit', '5,5,1,2,3,4,5,6,7,8'],
    ['filler words', '55 ok 1234 ok 5678'],
    ['a letter per digit', '5x5x1x2x3x4x5x6x7x8'],
    ['five spaces', '55     1234     5678'],
    ['emoji', '5😀5😀1😀2😀3😀4😀5😀6😀7😀8'],
    [
      'long filler between card groups',
      '4111 abcdefghijklmnopqrstu 1111 abcdefghijklmnopqrstu 1111 abcdefghijklmnopqrstu 1111',
    ],
    ['consecutive l confusables', '4lll 1lll 1lll 1lll'],
    ['consecutive O confusables', '4OO1 1OO1 1OO1 1OO1'],
    ['alternating confusables', '4l1l 1l1l 1l1l 1l1l'],
    ['trailing confusables', '4111 1111 1111 1lll'],
    ['registry-shaped phone', 'tx_5512a3456a78'],
    ['customer-shaped phone', 'cus_5512a3456a78'],
    ['dingbat digits', '❶❶❶❶❶❶❶❶❶❶❶❶❶❶❶❶'],
    ['negative circled phone', '❺❺❶❷❸❹❺❻❼❽'],
    ['CJK numerals', '五五一二三四五六七八'],
    ['a combining mark after a digit', '4́111111111111111'],
    ['a NUL after a digit', '4\u0000111111111111111'],
    [
      'keycap digits',
      `5${KEYCAP}5${KEYCAP}1${KEYCAP}2${KEYCAP}3${KEYCAP}4${KEYCAP}5${KEYCAP}6${KEYCAP}7${KEYCAP}8${KEYCAP}`,
    ],
  ])('leaves at most four digits of %s', (_, text) => {
    expect(digitsLeft(maskPii(text))).toBeLessThanOrEqual(MAX_DIGITS_SHOWN);
  });

  it.each([
    [
      'semicolon-separated words',
      'cinco; cinco; uno; dos; tres; cuatro; cinco; seis; siete; ocho',
    ],
    [
      'words joined by y',
      'cinco y cinco y uno y dos y tres y cuatro y cinco y seis y siete y ocho',
    ],
    ['doble', 'doble cuatro doble uno doble uno doble uno'],
    ['triple', 'triple cinco triple uno triple dos'],
    ['veinte y uno', 'veinte y uno veinte y uno veinte y uno veinte y uno'],
    ['treinta y un', 'treinta y un treinta y un treinta y un treinta y un'],
  ])('folds number words written with %s and masks them', (_, text) => {
    const masked = maskPii(text);
    expect(masked).not.toBe(text);
    expect(digitsLeft(masked)).toBeLessThanOrEqual(MAX_DIGITS_SHOWN);
  });

  it.each([
    ['a short base64 phone', 'NTUxMjM0NTY3OA=='],
    ['a short base64 RFC', 'UEVHODUwMTAxQUIx'],
  ])('masks %s', (_, text) => {
    expect(maskPii(text)).toMatch(/^ref ••••/);
  });

  it.each([
    ['CURP glued after', 'PEGJ850101HDFRRN09x', 'CURP ••••x'],
    ['RFC glued after', 'rfc PEG850101AB1x', 'RFC ••••x'],
    ['CURP with a split sex letter', 'PEGJ850101 H DFRRN 09', 'CURP ••••'],
    ['CURP with two spaces', 'PEGJ850101HDFRRN  09', 'CURP ••••'],
    ['RFC with spaces', 'PEG 850101 AB1', 'RFC ••••'],
  ])('masks an identity document %s', (_, text, expected) => {
    expect(maskPii(text)).toBe(expected);
  });

  it.each([
    ['mi nip:\n1234', 'mi nip:\n[factor]'],
    ['mi nip es cuatro cinco seis siete', 'mi nip es [factor]'],
    ['my one-time code is 123456', 'my one-time code is [factor]'],
    ['my security code is 1234', 'my security code is [factor]'],
    ['código de verificación. 123456', 'código de verificación. [factor]'],
    ['mi nip es 4,5,6,7', 'mi nip es [factor]'],
    ['mi nip es 4.5.6.7', 'mi nip es [factor]'],
    ['sms 123456', 'sms [factor]'],
  ])('masks the auth factor in %j', (text, expected) => {
    expect(maskPii(text)).toBe(expected);
  });

  it.each([
    ['juan.perez arroba gmail.com', 'j••• arroba gmail.com'],
    ['juan.perez at gmail.com', 'j••• at gmail.com'],
    ['juan.perez@localhost', 'j•••@localhost'],
    ['juan.perez@[192.168.0.1]', 'j•••@[núm ••••]'],
  ])('masks the email %s', (text, expected) => {
    expect(maskPii(text)).toBe(expected);
  });

  it.each([
    'mi nip es 1234 el 2024-01-15',
    'mi clave 1234 y mi tarjeta termina en 5678',
    'clave 1234 monto $1,500',
    'tel tel 5512345678',
  ])('is idempotent on %s', (text) => {
    const once = maskPii(text);
    expect(maskPii(once)).toBe(once);
  });

  it('absorbs every repeated label before a mask', () => {
    expect(maskPii('tel tel 5512345678')).toBe('tel ••••5678');
  });

  it.each([
    ['token expiró el 2024-01-15', 'token expiró el 2024-01-15'],
    [
      'mi código llegó el 2024-01-15 10:30',
      'mi código llegó el 2024-01-15 10:30',
    ],
    ['$1,500.00, $2,300.50, $99.99', '$1,500.00, $2,300.50, $99.99'],
    ['Cargos: 100.50, 200.75, 300.25', 'Cargos: 100.50, 200.75, 300.25'],
    [
      'Fecha 15/01/2024 10:30, monto 1200.50, ref 123456',
      'Fecha 15/01/2024 10:30, monto 1200.50, ref 123456',
    ],
    [
      'El 15 de enero de 2024 recibí 2500 pesos y el 20 de enero 3000 pesos',
      'El 15 de enero de 2024 recibí 2500 pesos y el 20 de enero 3000 pesos',
    ],
    ['CP 03100 y mi cel 5512345678', 'CP 03100 y mi cel tel ••••5678'],
    ['tx_a1b2 4111111111111111', 'tx_a1b2 tarjeta ••••1111'],
    ['el pedido número 123456789', 'el pedido número núm ••••'],
    ['clave de rastreo 123456789', 'clave de rastreo núm ••••'],
    ['operacion 987654321', 'operacion núm ••••'],
  ])('keeps what the spec needs in %j', (text, expected) => {
    expect(maskPii(text)).toBe(expected);
  });
});

describe('maskJson — attack review, round 3', () => {
  it.each([
    [{ id: 'tx_4111a1111a1111a1111' }],
    [{ id: '41111111-1111-1111-1111-111111111111' }],
    [{ x_hash: `${VISA}${'0'.repeat(48)}` }],
    [{ jti: 'juan.perez@gmail.com' }],
    [{ key_id: '4111 1111 1111 1111' }],
    [{ provider_request_id: `${VISA} hola 5512345678` }],
    [{ amount: Number(VISA) }],
    [{ x_ms: Number(VISA) }],
  ])('does not keep a value just because of its key: %j', (value) => {
    expect(maskJson(value)).not.toEqual(value);
  });

  it.each([
    [{ otp: '１２３４５６' }],
    [{ nip: '1234 ' }],
    [{ otp: ' 123456' }],
    [{ otp: '1 2 3 4 5 6' }],
    [{ cvc: '12-3' }],
    [{ otp: ['1', '2', '3', '4'] }],
    [{ otp: { a: '1234' } }],
    [{ otp: [123456] }],
    [{ password: 'hunter2' }],
    [{ token: 'abcdef' }],
    [{ otp_code: '123456' }],
    [{ authCode: '123456' }],
    [{ security_code: '123' }],
  ])('replaces an auth-factor value whole: %j', (value) => {
    const [key] = Object.keys(value);
    expect(maskJson(value)).toEqual({ [key ?? '']: '[factor]' });
  });

  it('keeps an error code, which is not an auth factor', () => {
    expect(maskJson({ error_code: 'no_api_key' })).toEqual({
      error_code: 'no_api_key',
    });
  });

  it('keeps a plausible epoch timestamp under a time key', () => {
    expect(maskJson({ created_at: 1727000000000 })).toEqual({
      created_at: 1727000000000,
    });
  });

  it('survives circular and very deep structures', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => maskJson(circular)).not.toThrow();
    let deep: unknown = 'x';
    for (let i = 0; i < 20_000; i++) deep = [deep];
    expect(() => maskJson(deep)).not.toThrow();
  });

  it('masks bigints, binary data and keys', () => {
    expect(maskJson({ phone: 5512345678n })).toEqual({ phone: 'tel ••••5678' });
    expect(maskJson({ raw: Buffer.from(VISA) })).toEqual({ raw: '[binary]' });
    expect(maskJson({ [VISA]: 'x' })).toEqual({ 'tarjeta ••••1111': 'x' });
  });
});

describe('maskPii — attack review, round 4', () => {
  it.each([
    ['PEGJ850101 AB1'],
    ['PEGJ 850101 AB 1'],
    ['PEGJ850101-AB-1'],
    ['PEGJ85/01/01AB1'],
    ['P E G J 8 5 0 1 0 1 A B 1'],
    ['PEGJ 85 01 01 AB1'],
    ['RFC PEGJ 8501 01 1B3'],
  ])('masks the RFC written as %s', (text) => {
    const masked = maskPii(text);
    expect(masked).toMatch(/RFC ••••$/);
    expect(masked).not.toMatch(/PEGJ|P E G J/);
  });

  it.each([
    ['PEGJ 850101 H DF RRN 09'],
    ['PEGJ 850101 HDF RRN 0 9'],
    ['PEGJ850101HDF-RRN-09'],
  ])('masks the CURP written as %s', (text) => {
    expect(maskPii(text)).toBe('CURP ••••');
  });

  it.each([
    ['Cyrillic letters in an RFC', 'РЕGJ850101AB1', 'RFC ••••'],
    ['a Cyrillic p in pin', 'рin 1234', 'pin [factor]'],
    ['a Cyrillic n in nip', 'пip 1234', 'nip [factor]'],
    ['a dotted keyword', 'mi n.i.p. es 1234', 'mi n.i.p. es [factor]'],
  ])('folds %s', (_, text, expected) => {
    expect(maskPii(text)).toBe(expected);
  });

  it('leaves a word written only in Cyrillic alone', () => {
    expect(maskPii('спасибо')).toBe('спасибо');
  });

  it.each([
    'mi cel es cinco cinco uno dos tres -- -- cuatro cinco seis siete ocho',
    'cinco cinco uno dos tres. Luego: cuatro cinco seis siete ocho',
    'cinco cinco uno dos tres y el resto es cuatro cinco seis siete ocho',
    'fifty five twelve thirty four fifty six seventy eight',
    'five five oh one two three four five six seven',
    'quinientos cincuenta y cinco doce treinta y cuatro cincuenta y seis setenta y ocho',
    'cinq cinq un deux trois quatre cinq six sept huit',
    'cinco cinco um dois três quatro cinco seis sete oito',
    'fünf fünf eins zwei drei vier fünf sechs sieben acht',
  ])('masks a number spoken in parts or other words: %s', (text) => {
    const masked = maskPii(text);
    expect(masked).not.toBe(text);
    expect(digitsLeft(masked)).toBeLessThanOrEqual(MAX_DIGITS_SHOWN);
  });

  it.each([
    ['juan.perez AT example.com', 'j••• AT example.com'],
    ['juan.perez [at] example.com', 'j••• [at] example.com'],
    ['juan.perez (at) example.com', 'j••• (at) example.com'],
    ['jperez(arroba)gmail.com', 'j•••(arroba)gmail.com'],
    ['jperez at gmail dot com', 'j••• at gmail dot com'],
    ['user%40example.com', 'u•••@example.com'],
    ['user&#64;example.com', 'u•••@example.com'],
  ])('masks the email %s', (text, expected) => {
    expect(maskPii(text)).toBe(expected);
  });

  it('masks every local part of glued addresses', () => {
    const masked = maskPii('maria@x.com-juan@y.com');
    expect(masked).not.toContain('maria');
    expect(masked).not.toContain('juan');
  });

  it.each([
    ['password: hunter2', 'password: [factor]'],
    ['mi contraseña es Perro123', 'mi contraseña es [factor]'],
    ['mi clave de acceso es abc123', 'mi clave de acceso es [factor]'],
    ['NIP is one two three four', 'NIP is [factor]'],
    ['cvv one two three', 'cvv [factor]'],
    ['my pin is twelve thirty four', 'my pin is [factor]'],
    ['cvv: ciento veintitres', 'cvv: [factor]'],
    ['nip cuatro-tres-dos-uno', 'nip [factor]'],
    ['codigo de verificación 12 34 56', 'codigo de verificación [factor]'],
    ['nip: 1 2 3 4 5 6 7 8 9', 'nip: [factor]'],
    ['nip 12.34', 'nip [factor]'],
    ['nip: 1_2_3_4', 'nip: [factor]'],
    ['cvv: 12 3', 'cvv: [factor]'],
    ['pin [1234]', 'pin [[factor]]'],
    ['1234 is my pin', '[factor] is my pin'],
    ['1234, mi nip', '[factor], mi nip'],
    [
      'los tres dígitos de atrás de mi tarjeta son 123',
      'los tres dígitos de atrás de mi tarjeta son [factor]',
    ],
    ['mi palabra secreta es 1234', 'mi palabra secreta es [factor]'],
    ['número secreto 1234', 'número secreto [factor]'],
  ])('masks the auth factor in %j', (text, expected) => {
    expect(maskPii(text)).toBe(expected);
  });

  it.each([
    ['w6k1NTEyMzQ1Njc4'],
    ['NTUxMjM0NTY3OMOp'],
    ['ADU1MTIzNDU2Nzg='],
    ['x=NTUxMjM0NTY3OA=='],
    ['https://x.com/?t=NTUxMjM0NTY3OA==&u=1'],
  ])('masks base64 that hides a phone: %s', (text) => {
    expect(maskPii(text)).toContain('ref ••••');
  });

  it('shows no padding as the tail of an opaque token', () => {
    expect(maskPii('GU2TEMBXGQ4TKNZYHE======')).not.toMatch(/====$/);
  });

  it.each([
    '55123456787 1234 cuatroO1O1O1O1O1O1O1O1١٢٣٤٥٦٧٨ ',
    'núm ••••juan@x.comjuan@x.com',
    'maria@x.com-juan@y.com',
  ])('is idempotent on %j', (text) => {
    const once = maskPii(text);
    expect(maskPii(once)).toBe(once);
  });

  it.each([
    'Mi saldo era de $10,543.21 y ahora es $9,543.21, me falta $1,000.00.',
    'Cargos: $100.00, $200.00, $300.00, $400.00 el 01/01/2025',
    'Pagué $15,000.00 de renta, $2,300.00 de luz y $850.00 de agua',
    'El pago de $100.00, $200.00, $300.00 y $400.00 se aplicó',
    'Son $1,234,567.89 en total?',
    'La tasa anual es 24.5% y el plazo es por 24 meses, me cobran desde hace 30 días',
    'Orden 4455667 y pedido 7788991 pagados con $1,500.00 el 2025-07-07.',
    'Total de $12,345.67 + $8,901.23 = $21,246.90 ref 123456.',
    'Me llamaron a las 12:00 13:00 14:00',
    'Contrato 2025-0042, vigencia 01/01/2025',
  ])('leaves ordinary support text unchanged: %s', (text) => {
    expect(maskPii(text)).toBe(text);
  });
});

describe('maskJson — attack review, round 4', () => {
  it.each([
    [{ 'pin-code': '1234' }],
    [{ 'auth code': '123456' }],
    [{ 'x.otp': '1' }],
    [{ 'otp value': '1' }],
    [{ clave: '1234' }],
    [{ contrasena: 'abc' }],
    [{ pwd: 'abc' }],
    [{ passwd: 'x' }],
    [{ pass: 'x' }],
    [{ totp: '123456' }],
    [{ mfa_code: '123456' }],
    [{ '2fa': '123456' }],
    [{ secreto: 'x' }],
    [{ pins: ['1234'] }],
  ])('replaces the value of %j whole', (value) => {
    const [key] = Object.keys(value);
    expect(maskJson(value)).toEqual({ [key ?? '']: '[factor]' });
  });

  it('masks the value of a name/value pair naming an auth factor', () => {
    expect(maskJson({ name: 'nip', value: '1234' })).toEqual({
      name: 'nip',
      value: '[factor]',
    });
    expect(maskJson([['cvv', '123']])).toEqual([['cvv', '[factor]']]);
  });

  it.each([
    [{ tel: 5512.345678 }],
    [{ x: 12345.67891 }],
    [{ amount: 5512.345678901 }],
    [{ cents: 1234567.8901234567 }],
    [{ amount: 0.002010077777777771 }],
  ])('masks numbers whose digits carry a value: %j', (value) => {
    expect(maskJson(value)).not.toEqual(value);
  });

  it('keeps an ordinary amount with cents', () => {
    expect(maskJson({ amount: 1250.5 })).toEqual({ amount: 1250.5 });
  });

  it('unboxes primitive wrappers before masking', () => {
    expect(maskJson({ a: new String('5512345678') })).toEqual({
      a: 'tel ••••5678',
    });
  });

  it('does not keep a UUID-shaped number under an id key', () => {
    const value = { account_id: '55123456-7890-1234-5678-90123456789a' };
    expect(maskJson(value)).not.toEqual(value);
  });

  it('does not throw on throwing getters', () => {
    const value = {
      get a(): string {
        throw new Error('boom');
      },
    };
    expect(() => maskJson(value)).not.toThrow();
  });

  it('keeps both values when two keys mask to the same text', () => {
    const masked = maskJson({ '5512345678': 1, 'tel ••••5678': 2 }) as Record<
      string,
      number
    >;
    expect(Object.values(masked).sort()).toEqual([1, 2]);
  });
});

describe('hasPii (02 G5 PII_IN_REPLY)', () => {
  it.each([
    ['an ellipsis', 'Gracias… te escribimos pronto.'],
    ['a no-break space', 'Hola\u00a0Ana, ya quedó.'],
    ['an ordinal sign', 'Tu aclaración Nº 5 sigue abierta.'],
    ['an emoji with a variation selector', 'Gracias ❤️'],
    ['decomposed accents', 'aclaración'.normalize('NFD')],
    ['number words', 'Sigue los pasos uno, dos y tres.'],
  ])('ignores %s, which only folding changes', (_, text) => {
    expect(hasPii(text)).toBe(false);
  });

  it.each([
    ['a CLABE', 'Tu CLABE es 012180001234567891.'],
    ['a card number', 'Tarjeta 4111 1111 1111 1111.'],
    ['a phone in pairs', 'Llámanos al 55 12 34 56 78.'],
    [
      'a CLABE in number words',
      'cero uno dos uno ocho cero cero cero uno dos tres cuatro',
    ],
  ])('finds %s', (_, text) => {
    expect(hasPii(text)).toBe(true);
  });
});

describe('visibleTailOf', () => {
  it('returns the last digits a masked value shows', () => {
    expect(visibleTailOf(maskPii(CLABE))).toBe('7899');
  });

  it('returns nothing for a value masked with no tail or not masked', () => {
    expect(visibleTailOf(maskPii('1234 5678'))).toBeUndefined();
    expect(visibleTailOf('7899')).toBeUndefined();
  });
});
