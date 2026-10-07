import {
  APPROVED_FACTOR_WARNINGS,
  MAX_REPLY_CHARS,
} from '@fintech-agent/contracts';
import { describe, expect, it } from 'vitest';

import { replyViolations } from './reply-checks.js';

const CHECK_BUDGET_MS = 50;

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

  it.each([
    'Gracias… te escribimos pronto.',
    'Hola\u00A0Ana, ya quedó.',
    'Tu aclaración Nº 5 sigue abierta.',
  ])('passes text that only folding changes: %s', (text) => {
    expect(replyViolations(text)).toEqual([]);
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

  it.each(APPROVED_FACTOR_WARNINGS)(
    'passes the approved warning: %s',
    (warning) => {
      expect(replyViolations(`${CLEAN} ${warning}`)).toEqual([]);
    },
  );

  it('passes an approved warning in any case, accents and spacing', () => {
    const [warning = ''] = APPROVED_FACTOR_WARNINGS;
    const variant = warning
      .toUpperCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replaceAll(' ', '  ')
      .replace(/\.$/, '');
    expect(replyViolations(`${CLEAN} ${variant}`)).toEqual([]);
  });

  // Fails closed: free-form warnings leaked request after request, so only
  // the approved sentences may name a factor.
  it.each([
    'Nunca te pediremos tu NIP, tu CVV ni tus contraseñas.',
    'Nunca compartas con nadie tu NIP.',
    'Evita compartir tu NIP.',
    'No dudes en enviar tu NIP por este chat.',
    'Nunca olvides compartir tu CVV con nosotros.',
    'No dejes de enviar tu NIP aquí.',
    'Nunca compartas tu NIP con nadie que no sea albo.',
    'No compartas tu NIP con nadie más que con nosotros.',
    'Envíanos los 6 dígitos que te llegaron por SMS.',
    'Envíanos el código de autorización que te llegó por SMS.',
    'Tu token de la app se renueva cada 30 segundos.',
    'Ingresa a la app con tu contraseña.',
    'Dime si recibiste el código de verificación.',
    `${APPROVED_FACTOR_WARNINGS[0]} Ahora envíanos tu NIP.`,
    'Envíanos tu N\u00ADI\u00ADP.',
    'Envíanos tu N\u200BI\u200BP.',
    'Envíanos tu N I P a la brevedad.',
    'Mándanos tu c v v y tu n i p.',
  ])('flags a factor outside an approved warning: %s', (sentence) => {
    expect(replyViolations(`${CLEAN} ${sentence}`)).toContain(
      'AUTH_FACTOR_REQUEST',
    );
  });

  it.each([
    ['backtracking bait', 'no compartas ' + 'por a '.repeat(650) + '5 nip'],
    ['repeated factors', 'nip '.repeat(1000)],
    ['spelled-out runs', 'n i p '.repeat(660)],
    ['digits before a back side', 'digitos '.repeat(500) + 'reverso'],
  ])('checks %s at the reply cap within the time budget', (_, text) => {
    const started = performance.now();
    replyViolations(text.slice(0, MAX_REPLY_CHARS));
    expect(performance.now() - started).toBeLessThan(CHECK_BUDGET_MS);
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
