import { describe, expect, it } from 'vitest';

import config from '../vite.config.js';

describe('console build (02 G7 CSP)', () => {
  it('inlines no asset as a data: URL, which default-src self refuses', () => {
    expect(config.build?.assetsInlineLimit).toBe(0);
  });
});
