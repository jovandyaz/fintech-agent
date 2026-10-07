import { MAX_REPLY_CHARS } from '@fintech-agent/contracts';
import { describe, expect, it } from 'vitest';

import { editRatio } from './edit-ratio.js';

describe('editRatio (01 reply_edit_ratio)', () => {
  it.each([
    ['an unchanged reply', 'Hola Ana', 'Hola Ana', 0],
    ['one substitution in four characters', 'gato', 'pato', 0.25],
    ['a full rewrite', 'abc', 'xyz', 1],
    ['an insertion', 'Hola', 'Hola!', 0.2],
    ['an empty draft', '', 'Hola', 1],
    ['two empty texts', '', '', 0],
  ])('is %s → %d', (_, draft, final, ratio) => {
    expect(editRatio(draft, final)).toBeCloseTo(ratio);
  });

  it('counts code points, so an accent is one edit', () => {
    expect(editRatio('aclaracion', 'aclaración')).toBeCloseTo(0.1);
  });

  it('handles the longest replies the API accepts', () => {
    const draft = 'a'.repeat(MAX_REPLY_CHARS);
    const final = 'b'.repeat(MAX_REPLY_CHARS);
    expect(editRatio(draft, final)).toBe(1);
  });
});
