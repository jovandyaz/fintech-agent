import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

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

  it('stops the real entrypoint before anything starts', () => {
    const run = spawnSync(
      process.execPath,
      ['--import', 'tsx', resolve(import.meta.dirname, 'main.ts')],
      {
        cwd: resolve(import.meta.dirname, '..'),
        env: { PATH: process.env.PATH, CORE_EXECUTOR_KEY: 'x' },
        encoding: 'utf8',
      },
    );

    expect(run.status).not.toBe(0);
    const lines = run.stderr.trim().split('\n');
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      expect.objectContaining({
        level: 'error',
        event: 'boot_failed',
        reason: expect.stringMatching(/CORE_EXECUTOR_KEY/) as unknown,
      }),
    ]);
  });
});
