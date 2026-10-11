import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const consoleFile = (name: string): string =>
  readFileSync(resolve(import.meta.dirname, '../../console', name), 'utf8');
const NGINX = consoleFile('nginx.conf');
const SECURITY_HEADERS = consoleFile('security-headers.conf');
const SECURITY_INCLUDE = 'include /etc/nginx/snippets/security-headers.conf;';
const LOCATION_BLOCK = /location [^{]+\{[^}]*\}/g;
const locationNamed = (path: string): string =>
  (NGINX.match(LOCATION_BLOCK) ?? []).find((block) =>
    block.startsWith(`location ${path} {`),
  ) ?? '';

describe('console nginx (02 G3, G7)', () => {
  it('sends the 02 G7 CSP and the security headers from the server level', () => {
    for (const header of [
      `add_header Content-Security-Policy "default-src 'self'; img-src 'self'" always;`,
      'add_header X-Content-Type-Options "nosniff" always;',
      'add_header X-Frame-Options "DENY" always;',
      'add_header Referrer-Policy "no-referrer" always;',
    ]) {
      expect(SECURITY_HEADERS).toContain(header);
    }
    expect(NGINX.replace(LOCATION_BLOCK, '')).toContain(SECURITY_INCLUDE);
  });

  it('re-includes every header in a location that adds its own, so none drops the CSP', () => {
    const locations = NGINX.match(LOCATION_BLOCK) ?? [];
    expect(locations.length).toBeGreaterThan(0);
    expect(
      locations.filter(
        (block) =>
          block.includes('add_header') && !block.includes(SECURITY_INCLUDE),
      ),
    ).toEqual([]);
  });

  it('revalidates index.html on every load and keeps the hashed assets for good', () => {
    expect(locationNamed('/')).toContain(
      'add_header Cache-Control "no-cache" always;',
    );
    expect(locationNamed('/assets/')).toContain(
      'add_header Cache-Control "public, max-age=31536000, immutable";',
    );
  });

  it('proxies /api/ to api, resolved again as it restarts, with the 32 KB body limit', () => {
    expect(NGINX).toMatch(/resolver 127\.0\.0\.11 valid=\d+s/);
    expect(NGINX).toMatch(/set \$api_upstream api:3000;/);
    expect(NGINX).toMatch(
      /location \/api\/ \{[^}]*rewrite \^\/api\/\(\.\*\)\$ \/\$1 break;[^}]*proxy_pass http:\/\/\$api_upstream;/,
    );
    expect(NGINX).toMatch(/client_max_body_size 32k;/);
  });

  it('logs each request without its query, referer or user agent, which the client writes (02 G6)', () => {
    const format = /log_format (\w+) '([^;]*)';/.exec(NGINX);
    expect(format).not.toBeNull();
    const [, name, fields] = format!;
    expect(fields).not.toMatch(
      /\$(request\b|request_uri|request_body|args|is_args|query_string|arg_|http_|cookie_|sent_http_)/,
    );
    expect(NGINX).toMatch(new RegExp(`access_log \\S+ ${name};`));
    expect(NGINX.match(/access_log /g)).toHaveLength(1);
  });

  it('answers a missing asset with 404, not the app page', () => {
    expect(NGINX).toMatch(/location \/assets\/ \{[^}]*try_files \$uri =404;/);
  });

  it('replaces X-Forwarded-For with the address it saw, so no browser can add a hop', () => {
    expect(NGINX).toContain('proxy_set_header X-Forwarded-For $remote_addr;');
    expect(NGINX).not.toContain('$proxy_add_x_forwarded_for');
  });
});
