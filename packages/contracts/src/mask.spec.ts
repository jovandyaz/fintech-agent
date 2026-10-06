import { describe, expect, it } from 'vitest';

import { maskJson, maskPii } from './mask.js';

const CLABE = '012180001234567899';
const CLABE_PASSING_LUHN = '012180001234500267';
const VISA = '4111111111111111';
const VISA_FAILING_LUHN = '4111111111111112';
const AMEX = '378282246310005';
const NBSP = ' ';
const NARROW_NBSP = ' ';
const MAX_MASK_MS_FOR_32KB = 250;

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

  it('masks a CLABE glued to a word', () => {
    expect(maskPii(`clabe${CLABE}`)).toBe('clabeCLABE ••••7899');
  });
});

describe('maskPii — card numbers', () => {
  it('masks a Luhn-valid card number keeping the last four', () => {
    expect(maskPii(`tarjeta ${VISA}`)).toBe('tarjeta tarjeta ••••1111');
    expect(maskPii(AMEX)).toBe('tarjeta ••••0005');
  });

  it('masks a card number written in groups', () => {
    expect(maskPii('4111 1111 1111 1111')).toBe('tarjeta ••••1111');
    expect(maskPii('4111-1111-1111-1111')).toBe('tarjeta ••••1111');
  });

  it('keeps 16 digits that fail Luhn', () => {
    expect(maskPii(`referencia ${VISA_FAILING_LUHN}`)).toBe(
      `referencia ${VISA_FAILING_LUHN}`,
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
    expect(maskPii(`tarjeta${VISA}`)).toBe('tarjetatarjeta ••••1111');
  });

  it('masks an Amex number in 4-6-5 groups', () => {
    expect(maskPii('3782 822463 10005')).toBe('tarjeta ••••0005');
  });

  it('keeps the card grouping when an expiry date follows', () => {
    expect(maskPii('4111 1111 1111 1111 12 28')).toBe('tarjeta ••••1111 12 28');
  });
});

describe('maskPii — identity documents', () => {
  it('masks an RFC for a person and for a company', () => {
    expect(maskPii('RFC: GODE561231GR8')).toBe('RFC: RFC ••••');
    expect(maskPii('la empresa ABC680524P76')).toBe('la empresa RFC ••••');
  });

  it('masks an RFC typed in lowercase', () => {
    expect(maskPii('mi rfc es gode561231gr8')).toBe('mi rfc es RFC ••••');
  });

  it('masks a CURP as a CURP, not as an RFC inside it', () => {
    expect(maskPii('CURP GODE561231HDFRRN09')).toBe('CURP CURP ••••');
  });

  it.each([
    ['GODE 561231 GR8', 'RFC ••••'],
    ['GODE-561231-GR8', 'RFC ••••'],
    ['GODE 561231 HDFRRN 09', 'CURP ••••'],
    ['curpGODE561231HDFRRN09', 'curpCURP ••••'],
    ['rfcGODE561231GR8', 'rfcRFC ••••'],
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

  it('does not treat a SPEI tracking key as an auth factor', () => {
    expect(maskPii('clave de rastreo MBAN01002510050012345678')).toBe(
      'clave de rastreo MBAN01002510050012345678',
    );
  });
});

describe('maskPii — evidence ids stay intact', () => {
  it.each([
    '08bc9b76-6326-4987-8f2a-1c2d3e4f5a6b',
    '12345678-1234-1234-1234-123456789012',
    'rastreo 085904567890123456',
    '10 20 30 40 50 60 70 80 90',
    '2026-10-05 10:30',
    '05/10/2026',
    '192.168.1.1',
    'tx_0412',
  ])('leaves %s unchanged', (text) => {
    expect(maskPii(text)).toBe(text);
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
    ['digit pairs', '1 '.repeat(16_000)],
    ['five-digit groups', '12345 '.repeat(5_400)],
    ['dashed pairs', '12-'.repeat(10_900)],
    ['one long digit run', '9'.repeat(32_000)],
  ])('masks 32 KB of %s in linear time', (_, text) => {
    const start = performance.now();
    maskPii(text);
    expect(performance.now() - start).toBeLessThan(MAX_MASK_MS_FOR_32KB);
  });

  const benign = [
    'Hice una transferencia de $5,000.00 el 2026-10-05',
    'La referencia numérica es 1234567',
    'Clave de rastreo MBAN01002510050012345678',
    'El cargo fue a las 10:30 en OXXO',
    'Mi folio es CC-2026-000123',
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
    'Folio de aclaración 2026100500017',
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
        id: 1234567890,
        at: 1727000000000,
      }),
    ).toEqual({
      t: 'mi clabe CLABE ••••7899',
      nested: [{ email: 'a•••@albo.mx' }],
      id: 1234567890,
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
});
