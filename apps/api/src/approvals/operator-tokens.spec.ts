import { describe, expect, it } from 'vitest';

import { parseOperatorTokens, resolveOperator } from './operator-tokens.js';

const ANA = 'dev-operator-ana-token-0123456789';
const BETO = 'dev-operator-beto-token-0123456789';
const RAW = `ana:k1:${ANA},beto:k1:${BETO}`;

describe('parseOperatorTokens', () => {
  it('keeps the operator, the key id and a digest, never the token', () => {
    const credentials = parseOperatorTokens(RAW);
    expect(
      credentials.map(({ operatorId, keyId }) => [operatorId, keyId]),
    ).toEqual([
      ['ana', 'k1'],
      ['beto', 'k1'],
    ]);
    expect(JSON.stringify(credentials)).not.toContain(ANA);
  });

  it.each([
    ['a missing token', `ana:k1:${ANA},beto:k1`],
    ['an id outside [a-z0-9_-]', `Ana!:k1:${ANA}`],
    ['a token shorter than 24 characters', 'ana:k1:short-token'],
    ['the same token twice', `ana:k1:${ANA},beto:k1:${ANA}`],
    ['the same operator key twice', `ana:k1:${ANA},ana:k1:${BETO}`],
    ['nothing at all', ''],
  ])('refuses %s without echoing a token', (_, raw) => {
    let message = '';
    try {
      parseOperatorTokens(raw);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/OPERATOR_TOKENS/);
    expect(message).not.toContain(ANA);
    expect(message).not.toContain(BETO);
  });
});

describe('resolveOperator', () => {
  const credentials = parseOperatorTokens(RAW);

  it('resolves a known token to its operator and key', () => {
    expect(resolveOperator(credentials, BETO)).toEqual({
      id: 'beto',
      keyId: 'k1',
      actor: 'operator:beto',
    });
  });

  it.each([
    ['an unknown token', 'dev-operator-eve-token-0123456789'],
    ['a prefix of a valid token', ANA.slice(0, -1)],
    ['a valid token with a trailing space', `${ANA} `],
    ['an empty token', ''],
  ])('refuses %s', (_, presented) => {
    expect(resolveOperator(credentials, presented)).toBeNull();
  });
});
