import { describe, expect, it } from 'vitest';

import { maskPii } from './mask.js';

const CLABE = '012180001234567891';
const CLABE_PASSING_LUHN = '012180001234567894';
const VISA = '4111111111111111';
const VISA_FAILING_LUHN = '4111111111111112';
const AMEX = '378282246310005';

describe('maskPii — CLABE', () => {
  it('masks an 18-digit CLABE keeping the last four', () => {
    expect(maskPii(`Mi CLABE es ${CLABE}`)).toBe('Mi CLABE es CLABE ••••7891');
  });

  it('masks a CLABE written in groups with spaces or dashes', () => {
    expect(maskPii('0121 8000 1234 5678 91')).toBe('CLABE ••••7891');
    expect(maskPii('012-180-001234567891')).toBe('CLABE ••••7891');
  });

  it('treats 18 digits as a CLABE even when they pass Luhn', () => {
    expect(maskPii(CLABE_PASSING_LUHN)).toBe('CLABE ••••7894');
  });

  it('does not let a preceding date swallow a CLABE', () => {
    expect(maskPii(`2026-10-05 ${CLABE}`)).toBe('2026-10-05 CLABE ••••7891');
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
});

describe('maskPii — contact data', () => {
  it('masks an email keeping the first letter and the domain', () => {
    expect(maskPii('escríbanme a juan.perez@gmail.com')).toBe(
      'escríbanme a j•••@gmail.com',
    );
  });

  it('masks a Mexican phone number with or without +52', () => {
    expect(maskPii('mi cel 5512345678')).toBe('mi cel tel ••••5678');
    expect(maskPii('llámenme al +52 55 1234 5678')).toBe(
      'llámenme al tel ••••5678',
    );
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
