import { describe, expect, it } from 'vitest';

import { assertApiEnv } from './boot.js';

describe('api boot (02 G1 process boundary)', () => {
  it.each(['dev-core-executor-key', ''])(
    'refuses to start holding CORE_EXECUTOR_KEY (%j)',
    (value) => {
      expect(() => assertApiEnv({ CORE_EXECUTOR_KEY: value })).toThrow(
        /CORE_EXECUTOR_KEY/,
      );
    },
  );

  it('starts without it', () => {
    expect(() => assertApiEnv({})).not.toThrow();
  });
});
