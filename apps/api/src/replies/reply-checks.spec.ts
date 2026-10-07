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
    'Danos tu NIP.',
    'Favor de enviar tu NIP.',
    'Te pedimos que nos envíes tu CVV.',
    'Debes enviarnos tu NIP.',
    'Solicitamos tu contraseña.',
    'Responde este correo con tu NIP.',
    'Envíanos tu clave para validar.',
    'Envíanos los 3 dígitos al reverso de tu tarjeta.',
    'Mándanos el código que recibiste por SMS.',
    'Tu NIP, compártelo con nosotros.',
    'Envíanos ¿tu NIP? para continuar',
    'Comparte con nosotros (¡por favor!) tu CVV',
    'Envíanos\ntu NIP',
    'No compartas esto con nadie, pero envíanos tu NIP.',
    'No des tu NIP a nadie, excepto a nosotros.',
    'No des tu NIP a nadie, a nosotros sí.',
    'Envíanos tu N.I.P. para validar.',
    'Envíanos tu n-i-p.',
    'Envíanos tu N I P.',
    'Confírmanos tu c.v.v',
    'Envíanos tu NlP.',
    'Envíanos tu N1P.',
    'Envíanos tu \u039D\u0399\u03A1.',
    'Envíanos tus NIPs.',
    'Envíanos tu CVC2.',
    'Escribe tu contraceña aquí.',
    'Escribe tu contrasenia aquí.',
    'Mándanos tu passcode.',
    'Danos tu código.',
    'Envíanos los 3 números de atrás de tu tarjeta.',
    'Dinos el numerito secreto.',
    'Comparte tu llave dinámica.',
  ])('flags AUTH_FACTOR_REQUEST: %s', (sentence) => {
    expect(replyViolations(`${CLEAN} ${sentence}`)).toContain(
      'AUTH_FACTOR_REQUEST',
    );
  });

  it.each([
    'Nunca te pediremos tu NIP, tu CVV ni tus contraseñas.',
    'albo no te solicitará tu NIP por ningún medio.',
    'No compartas tu código de verificación con nadie.',
    'Envíanos una captura del movimiento. Nunca compartas tu NIP.',
    'No necesitamos tu NIP para revisar el cargo.',
    'Jamás te pediremos que nos confirmes tu CVV.',
    'Nunca, por ningún motivo, necesitamos tu contraseña.',
    'Albo no te solicitará jamás tu NIP.',
    'Nunca compartas con nadie tu NIP.',
    'Nadie de albo te pedirá tu NIP.',
    'Ningún colaborador te pedirá tu NIP ni tu CVV.',
    'Ni albo ni sus ejecutivos te pedirán tu NIP.',
    'Nunca te pediremos por teléfono tu NIP.',
    'Evita compartir tu NIP.',
  ])('passes a warning that only names a factor: %s', (sentence) => {
    expect(replyViolations(`${CLEAN} ${sentence}`)).toEqual([]);
  });

  // Fails closed: a factor may be named only inside a warning not to share it.
  it.each([
    'Tu token de la app se renueva cada 30 segundos.',
    'Ingresa a la app con tu contraseña.',
    'Dime si recibiste el código de verificación.',
  ])('flags a factor named outside a warning: %s', (sentence) => {
    expect(replyViolations(`${CLEAN} ${sentence}`)).toContain(
      'AUTH_FACTOR_REQUEST',
    );
  });

  it.each([
    'Tu clave de rastreo es la que aparece en el comprobante.',
    'Confirma tu código postal en la app.',
    'Tu clave de aclaración aparece en el acuse.',
    'El código de autorización del cargo aparece en tu estado de cuenta.',
    'Te enviaremos el comprobante a tu correo registrado.',
  ])('passes words that only look like factors: %s', (sentence) => {
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
