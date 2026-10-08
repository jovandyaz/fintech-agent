import { describe, expect, it } from 'vitest';

import { clearToken, readToken, saveToken } from './token.js';

const failing: Storage = {
  length: 0,
  clear: () => undefined,
  key: () => null,
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

describe('operator token storage', () => {
  it('keeps the token for this tab only, until cleared', () => {
    saveToken('dev-operator-ana-token-0123456789');
    expect(readToken()).toBe('dev-operator-ana-token-0123456789');
    expect(localStorage.length).toBe(0);
    clearToken();
    expect(readToken()).toBeNull();
  });

  it('reads no token and never throws when storage is blocked', () => {
    expect(() => saveToken('x', failing)).not.toThrow();
    expect(readToken(failing)).toBeNull();
    expect(() => clearToken(failing)).not.toThrow();
  });
});
