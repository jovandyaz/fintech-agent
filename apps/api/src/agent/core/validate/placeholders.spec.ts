import { describe, expect, it } from 'vitest';

import { replyViolations } from '../../../replies/reply-checks.js';
import { fillPlaceholders, placeholdersIn } from './placeholders.js';

const FOLIO = 'AC-7K2M-Q9XP';
const filled = (text: string, receivedAt: string, firstName = 'Ana') =>
  fillPlaceholders(text, {
    receivedAt: new Date(receivedAt),
    folio: FOLIO,
    firstName,
  });

describe('placeholdersIn', () => {
  it('names every placeholder, known or not', () => {
    expect(
      placeholdersIn(
        'Hola {{nombre}}, folio {{folio}}; {{monto}} y {{ folio }}',
      ),
    ).toEqual(['nombre', 'folio', 'monto', ' folio ']);
  });
});

describe('fillPlaceholders', () => {
  it('fills the name, the folio and the received date in Mexico City', () => {
    expect(
      filled(
        'Hola {{nombre}}, tu folio es {{folio}}, recibido el {{fecha_recepcion}}.',
        '2026-10-08T03:00:00Z',
      ),
    ).toBe(`Hola Ana, tu folio es ${FOLIO}, recibido el 07/10/2026.`);
  });

  it('puts the dictamen 45 natural days after reception', () => {
    expect(filled('{{fecha_limite_dictamen}}', '2026-10-07T15:00:00Z')).toBe(
      '21/11/2026',
    );
  });

  it('puts the credit on the second business day after reception', () => {
    expect(filled('{{fecha_limite_abono}}', '2026-10-07T15:00:00Z')).toBe(
      '09/10/2026',
    );
    expect(filled('{{fecha_limite_abono}}', '2026-10-10T18:00:00Z')).toBe(
      '13/10/2026',
    );
    expect(filled('{{fecha_limite_abono}}', '2026-11-13T18:00:00Z')).toBe(
      '18/11/2026',
    );
    expect(filled('{{fecha_limite_abono}}', '2026-12-31T18:00:00Z')).toBe(
      '05/01/2027',
    );
  });

  it('renders the commitments from approved wording with their dates', () => {
    const reply = filled(
      'Hola {{nombre}}. {{compromiso_abono}} {{compromiso_dictamen}}',
      '2026-10-07T15:00:00Z',
    );
    expect(reply).toContain('09/10/2026');
    expect(reply).toContain('21/11/2026');
    expect(reply).toContain('CONDUSEF');
    expect(reply).not.toContain('{{');
    expect(replyViolations(reply)).toEqual([]);
  });

  // The first full eval run: long Spanish dates left their days as loose
  // digits that, with the amount, crossed the masker's message budget.
  it('fills a draft that names an amount, a date and a time without tripping PII_IN_REPLY', () => {
    const reply = filled(
      'Hola {{nombre}}. Revisamos el cargo de 1599 en MERCADOPAGO *TIENDAXYZ del 2026-10-03 a las 19:25. Tu folio es {{folio}}, con fecha de recepción {{fecha_recepcion}}. {{compromiso_abono}} {{compromiso_dictamen}}',
      '2026-10-05T21:00:00Z',
    );
    expect(replyViolations(reply)).toEqual([]);
  });

  // The masker exempts at most 32 date digits per message, all or none: the
  // three filled dates use 24, so a draft adding an ISO date with a time
  // crosses it and fails closed into the fallback (02 G5, residual).
  it('still fails closed past the masker date cap', () => {
    const reply = filled(
      'Hola {{nombre}}. Revisamos el cargo de 1599 del 2026-10-03 22:10. Tu folio es {{folio}}, recibido el {{fecha_recepcion}}. {{compromiso_abono}} {{compromiso_dictamen}}',
      '2026-10-05T21:00:00Z',
    );
    expect(replyViolations(reply)).toEqual(['PII_IN_REPLY']);
  });

  it('refuses a placeholder it cannot fill', () => {
    expect(() => filled('{{monto}}', '2026-10-07T15:00:00Z')).toThrow();
    expect(() =>
      fillPlaceholders('Hola {{nombre}}', {
        receivedAt: new Date('2026-10-07T15:00:00Z'),
        folio: FOLIO,
        firstName: null,
      }),
    ).toThrow();
  });

  // The name comes from core data, after validation: a figure or a promise in
  // it would reach the reply unchecked by UNGROUNDED_NUMBER and COMMITMENT.
  it('fills only a name made of letters, spaces and name punctuation', () => {
    const at = '2026-10-07T15:00:00Z';
    for (const name of [
      'María José',
      "O'Neil",
      'O’Neil',
      'Ana-Lucía',
      'J. Pérez',
    ]) {
      expect(filled('Hola {{nombre}}', at, name)).toBe(`Hola ${name}`);
    }
    expect(filled('Hola {{nombre}}', at, 'Jose\u0301')).toBe('Hola José');
    for (const name of ['Ana 500', 'Ana, te reembolsaremos', 'Ana\nhola', '']) {
      expect(() => filled('Hola {{nombre}}', at, name)).toThrow();
    }
  });
});
