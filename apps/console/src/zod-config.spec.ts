import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import './zod-config.js';

describe('zod in the browser (02 G7 CSP)', () => {
  it('never probes eval, which the CSP refuses and reports on every load', () => {
    expect(z.config().jitless).toBe(true);
  });
});
