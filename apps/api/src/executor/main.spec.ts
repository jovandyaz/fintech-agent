import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const KEY = 'executor-spec-key-not-real';
// Node clamps a timer past 2^31-1 ms to 1 ms, so the loop would poll nonstop.
const OVERSIZED_POLL_MS = '3000000000';
// A booted executor loops until stopped; a refused one exits at once.
const BOOT_TIMEOUT_MS = 10_000;

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

  it('refuses a poll interval Node would clamp, before it opens a connection', () => {
    const run = spawnSync(
      process.execPath,
      ['--import', 'tsx', resolve(import.meta.dirname, 'main.ts')],
      {
        cwd: resolve(import.meta.dirname, '../..'),
        env: {
          PATH: process.env.PATH,
          CORE_EXECUTOR_KEY: KEY,
          CORE_MOCK_URL: 'http://127.0.0.1:1',
          EXECUTOR_DATABASE_URL:
            'postgresql://copilot_executor:x@127.0.0.1:1/x',
          EXECUTOR_POLL_MS: OVERSIZED_POLL_MS,
        },
        encoding: 'utf8',
        timeout: BOOT_TIMEOUT_MS,
      },
    );

    expect(run.status).not.toBe(0);
    const lines = run.stderr.trim().split('\n');
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      expect.objectContaining({ level: 'error', event: 'boot_failed' }),
    ]);
    expect(run.stderr).toContain('EXECUTOR_POLL_MS');
    expect(run.stderr + run.stdout).not.toContain(KEY);
  });
});
