import { describe, expect, it } from 'vitest';

import {
  ID_PREFIXES,
  isFolio,
  isRegistryId,
  newFolio,
  newRegistryId,
  registryIdPattern,
} from './ids.js';
import { maskPii } from './mask.js';

const FOLIO_SAMPLES = 2_000;
const ALL_DIGITS_FIRST = (): number => 0;

describe('isRegistryId', () => {
  it.each([
    'tx_0412',
    'case_ab12',
    'cus_07',
    'chunk_p04s2',
    'run_9f3a',
    'act_x1',
  ])('accepts %s', (id) => {
    expect(isRegistryId(id)).toBe(true);
  });

  it.each([
    'tx_41111',
    'tx_4111111111111111',
    'pol_0412',
    'TX_0412',
    'tx_',
    'tx_04-12',
    'tx_5512a3456a78',
    'tx_1a2b3c4d5e',
  ])('rejects %s', (id) => {
    expect(isRegistryId(id)).toBe(false);
  });
});

describe('newFolio', () => {
  it('always has a letter in each group, so the masker never touches it', () => {
    for (let i = 0; i < FOLIO_SAMPLES; i++) {
      const folio = newFolio();
      expect(isFolio(folio)).toBe(true);
      expect(maskPii(folio)).toBe(folio);
    }
  });

  it('forces a letter into a group the random source made all digits', () => {
    const folio = newFolio(ALL_DIGITS_FIRST);
    expect(isFolio(folio)).toBe(true);
  });

  it('rejects folios without a letter in a group', () => {
    expect(isFolio('AC-4111-1111')).toBe(false);
    expect(isFolio('AC-K7Q3-1111')).toBe(false);
    expect(isFolio('AC-K7Q3-M9X2')).toBe(true);
  });
});

describe('newRegistryId', () => {
  it.each(ID_PREFIXES)(
    'mints a %s id the registry and the masker accept',
    (prefix) => {
      for (let i = 0; i < 50; i += 1) {
        const id = newRegistryId(prefix);
        expect(id).toMatch(registryIdPattern(prefix));
        expect(isRegistryId(id)).toBe(true);
        expect(maskPii(id)).toBe(id);
      }
    },
  );

  it('does not repeat across many draws', () => {
    const ids = new Set(
      Array.from({ length: 1000 }, () => newRegistryId('case')),
    );
    expect(ids.size).toBe(1000);
  });
});
