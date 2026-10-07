import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('mcp boot', () => {
  it('fails with one JSON line when its env is incomplete', () => {
    const run = spawnSync(
      process.execPath,
      ['--import', 'tsx', resolve(import.meta.dirname, 'main.ts')],
      {
        cwd: resolve(import.meta.dirname, '..'),
        env: { PATH: process.env.PATH },
        encoding: 'utf8',
      },
    );

    expect(run.status).not.toBe(0);
    const lines = run.stderr.trim().split('\n');
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      expect.objectContaining({ level: 'error', event: 'boot_failed' }),
    ]);
  });
});
