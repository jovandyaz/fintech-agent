import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const KEY = 'executor-spec-key-not-real';

describe('executor boot', () => {
  it('fails with one JSON line that echoes no secret when its env is wrong', () => {
    const run = spawnSync(
      process.execPath,
      ['--import', 'tsx', resolve(import.meta.dirname, 'main.ts')],
      {
        cwd: resolve(import.meta.dirname, '../..'),
        env: {
          PATH: process.env.PATH,
          CORE_EXECUTOR_KEY: KEY,
          EXECUTOR_DATABASE_URL: `postgresql://copilot_executor:${KEY}@db host/x`,
        },
        encoding: 'utf8',
      },
    );

    expect(run.status).not.toBe(0);
    const lines = run.stderr.trim().split('\n');
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      expect.objectContaining({ level: 'error', event: 'boot_failed' }),
    ]);
    expect(run.stderr + run.stdout).not.toContain(KEY);
  });
});
