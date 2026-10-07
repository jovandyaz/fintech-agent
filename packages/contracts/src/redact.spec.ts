import { describe, expect, it } from 'vitest';

import { redactCredentials } from './redact.js';

const SECRET = 'ana-operator-dev-token-secret';

describe('redactCredentials (02 G6 logs)', () => {
  it.each([
    [`Authorization: Bearer ${SECRET}`, 'Authorization: Bearer [redacted]'],
    [`bearer ${SECRET}`, 'bearer [redacted]'],
    ['Basic dXNlcjpwYXNzd29yZA', 'Basic [redacted]'],
    [`Authorization: Token ${SECRET}`, 'Authorization: Token [redacted]'],
    [`/cb?access_token=${SECRET}&x=1`, '/cb?access_token=[redacted]&x=1'],
    [`/cb#case_token=${SECRET}`, '/cb#case_token=[redacted]'],
    [`token: ${SECRET}`, 'token: [redacted]'],
    [`password=${SECRET}`, 'password=[redacted]'],
    [`auth=${SECRET}`, 'auth=[redacted]'],
  ])('redacts %j', (text, expected) => {
    expect(redactCredentials(text)).toBe(expected);
  });

  it.each([
    'case token rejected',
    'Token rejected',
    'idempotency key=act_a1b2',
    'the bearer of bad news',
  ])('leaves prose and correlation ids alone: %j', (text) => {
    expect(redactCredentials(text)).toBe(text);
  });
});
