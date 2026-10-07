import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('core-mock boot', () => {
  it('fails with one JSON line naming the missing key', () => {
    const run = spawnSync(
      process.execPath,
      ['--import', 'tsx', resolve(import.meta.dirname, 'main.ts')],
      {
        cwd: resolve(import.meta.dirname, '..'),
        // Node 22 flags node:sqlite as experimental on stderr; the image runs 24.
        env: { PATH: process.env.PATH, NODE_NO_WARNINGS: '1' },
        encoding: 'utf8',
      },
    );

    expect(run.status).not.toBe(0);
    const lines = run.stderr.trim().split('\n');
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      expect.objectContaining({
        level: 'error',
        event: 'boot_failed',
        reason: 'CORE_READ_KEY is required',
      }),
    ]);
  });
});
