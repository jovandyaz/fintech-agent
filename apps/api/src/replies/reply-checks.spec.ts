import { describe, expect, it } from 'vitest';

import { replyViolations } from './reply-checks.js';

const CLEAN =
  'Hola Ana, registramos tu aclaración con folio AC-7KQ2-M9XD. Te responderemos por escrito a más tardar el 9 de octubre.';

describe('replyViolations (02 G5, the checks a final reply shares with the draft)', () => {
  it('passes a plain reply', () => {
    expect(replyViolations(CLEAN)).toEqual([]);
  });

  it.each([
    ['a full CLABE', `${CLEAN} Tu CLABE es 012180001234567891.`],
    [
      'a card number',
      `${CLEAN} Tu tarjeta 4111 1111 1111 1111 quedó bloqueada.`,
    ],
    ['a phone in pairs', `${CLEAN} Llámanos al 55 12 34 56 78.`],
  ])('flags PII_IN_REPLY for %s', (_, text) => {
    expect(replyViolations(text)).toContain('PII_IN_REPLY');
  });

  it.each([
    ['a markdown image', '![](https://evil.example/?d=x)'],
    ['raw html', '<img src=x>'],
    ['a bare domain', 'Entra a evil.ly/x'],
  ])('flags LINK_IN_REPLY for %s', (_, text) => {
    expect(replyViolations(`${CLEAN} ${text}`)).toContain('LINK_IN_REPLY');
  });

  it('passes a link to albo', () => {
    expect(
      replyViolations(`${CLEAN} Más información en https://albo.mx/ayuda.`),
    ).toEqual([]);
  });

  it.each([
    'Para continuar, envíanos tu NIP.',
    'Compártenos el código que te llegó por SMS.',
    '¿Nos confirmas tu CVV?',
    'Necesitamos tu contraseña para validar.',
    'Indícanos la clave dinámica que ves en la app.',
    'Dinos tu token de acceso.',
    'Por favor ingresa tu PIN en este chat.',
    'Escríbenos el código de verificación.',
    'No te preocupes, envíanos tu NIP y lo revisamos.',
    'Nunca dudes en escribirnos; confírmanos tu CVV.',
    'No necesitamos tu NIP, pero confírmanos tu CVV.',
  ])('flags AUTH_FACTOR_REQUEST: %s', (sentence) => {
    expect(replyViolations(`${CLEAN} ${sentence}`)).toContain(
      'AUTH_FACTOR_REQUEST',
    );
  });

  it.each([
    'Nunca te pediremos tu NIP, tu CVV ni tus contraseñas.',
    'albo no te solicitará tu NIP por ningún medio.',
    'No compartas tu código de verificación con nadie.',
    'Tu token de la app se renueva cada 30 segundos.',
    'Envíanos una captura del movimiento. Nunca compartas tu NIP.',
    'No necesitamos tu NIP para revisar el cargo.',
    'Jamás te pediremos que nos confirmes tu CVV.',
    'Nunca, por ningún motivo, necesitamos tu contraseña.',
  ])('passes a warning that only names a factor: %s', (sentence) => {
    expect(replyViolations(`${CLEAN} ${sentence}`)).toEqual([]);
  });

  it('reports each code once, in a fixed order', () => {
    expect(
      replyViolations(
        'Envíanos tu NIP a datos@evil.example o al 55 12 34 56 78.',
      ),
    ).toEqual(['PII_IN_REPLY', 'LINK_IN_REPLY', 'AUTH_FACTOR_REQUEST']);
  });
});
