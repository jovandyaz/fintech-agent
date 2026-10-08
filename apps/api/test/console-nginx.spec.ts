import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const NGINX = readFileSync(
  resolve(import.meta.dirname, '../../console/nginx.conf'),
  'utf8',
);

describe('console nginx (02 G3, G7)', () => {
  it("sends the 02 G7 CSP on every answer: default-src 'self'; img-src 'self'", () => {
    expect(NGINX).toContain(
      `add_header Content-Security-Policy "default-src 'self'; img-src 'self'" always;`,
    );
  });

  it('sets every header at server level, so no location drops the CSP', () => {
    const locations = NGINX.match(/location [^{]+\{[^}]*\}/g) ?? [];
    expect(locations.length).toBeGreaterThan(0);
    expect(locations.filter((block) => block.includes('add_header'))).toEqual(
      [],
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

  it('answers a missing asset with 404, not the app page', () => {
    expect(NGINX).toMatch(/location \/assets\/ \{[^}]*try_files \$uri =404;/);
  });

  it('replaces X-Forwarded-For with the address it saw, so no browser can add a hop', () => {
    expect(NGINX).toContain('proxy_set_header X-Forwarded-For $remote_addr;');
    expect(NGINX).not.toContain('$proxy_add_x_forwarded_for');
  });
});
