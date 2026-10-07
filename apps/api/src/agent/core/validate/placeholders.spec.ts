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
    ).toBe(`Hola Ana, tu folio es ${FOLIO}, recibido el 7 de octubre de 2026.`);
  });

  it('puts the dictamen 45 natural days after reception', () => {
    expect(filled('{{fecha_limite_dictamen}}', '2026-10-07T15:00:00Z')).toBe(
      '21 de noviembre de 2026',
    );
  });

  it('puts the credit on the second business day after reception', () => {
    expect(filled('{{fecha_limite_abono}}', '2026-10-07T15:00:00Z')).toBe(
      '9 de octubre de 2026',
    );
    expect(filled('{{fecha_limite_abono}}', '2026-10-10T18:00:00Z')).toBe(
      '13 de octubre de 2026',
    );
    expect(filled('{{fecha_limite_abono}}', '2026-11-13T18:00:00Z')).toBe(
      '18 de noviembre de 2026',
    );
    expect(filled('{{fecha_limite_abono}}', '2026-12-31T18:00:00Z')).toBe(
      '5 de enero de 2027',
    );
  });

  it('renders the commitments from approved wording with their dates', () => {
    const reply = filled(
      'Hola {{nombre}}. {{compromiso_abono}} {{compromiso_dictamen}}',
      '2026-10-07T15:00:00Z',
    );
    expect(reply).toContain('9 de octubre de 2026');
    expect(reply).toContain('21 de noviembre de 2026');
    expect(reply).toContain('CONDUSEF');
    expect(reply).not.toContain('{{');
    expect(replyViolations(reply)).toEqual([]);
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
