import { describe, expect, it } from 'vitest';

import { demoConfigOf } from './post-fixtures.js';

const KEY = Buffer.from('a-demo-webhook-secret-0123456789').toString('base64');
const OTHER = Buffer.from('another-demo-secret-0123456789ab').toString(
  'base64',
);
const EXAMPLE = `API_PORT=3000\nWEBHOOK_SECRET=whsec_${KEY}\n`;

describe('demoConfigOf', () => {
  it('takes its defaults from .env.example, the one place dev defaults live', () => {
    const config = demoConfigOf({}, EXAMPLE);
    expect(config.apiUrl).toBe('http://localhost:3000');
    expect(config.secret).toEqual(Buffer.from(KEY, 'base64'));
  });

  it('lets the environment override them', () => {
    const config = demoConfigOf(
      { API_PORT: '3999', WEBHOOK_SECRET: `whsec_${OTHER}` },
      EXAMPLE,
    );
    expect(config.apiUrl).toBe('http://localhost:3999');
    expect(config.secret).toEqual(Buffer.from(OTHER, 'base64'));
  });

  it('signs with the first secret while one rotates out', () => {
    const config = demoConfigOf(
      { WEBHOOK_SECRET: `whsec_${OTHER} whsec_${KEY}` },
      EXAMPLE,
    );
    expect(config.secret).toEqual(Buffer.from(OTHER, 'base64'));
  });

  it('refuses a secret that is not whsec_', () => {
    expect(() => demoConfigOf({ WEBHOOK_SECRET: 'plain' }, EXAMPLE)).toThrow();
  });
});
