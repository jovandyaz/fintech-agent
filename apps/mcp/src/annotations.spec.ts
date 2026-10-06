import { describe, expect, it } from 'vitest';

import { READ_ONLY } from './annotations.js';

describe('tool annotations (01 §Tools)', () => {
  it('marks a tool read-only, non-destructive, idempotent and closed-world', () => {
    expect(READ_ONLY).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });
});
