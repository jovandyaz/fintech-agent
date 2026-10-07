import { spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const BOOT_MS = 10_000;

let occupied: Server | undefined;

afterEach(async () => {
  await new Promise((done) => occupied?.close(done) ?? done(undefined));
  occupied = undefined;
});

function boot(env: Record<string, string>): {
  status: number | null;
  stderr: string;
} {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', resolve(import.meta.dirname, 'main.ts')],
    {
      cwd: resolve(import.meta.dirname, '..'),
      // Node 22 flags node:sqlite as experimental on stderr; the image runs 24.
      env: { PATH: process.env.PATH, NODE_NO_WARNINGS: '1', ...env },
      encoding: 'utf8',
      timeout: BOOT_MS,
    },
  );
}

function bootFailures(stderr: string): unknown[] {
  return stderr
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as unknown);
}

describe('core-mock boot', () => {
  it('fails with one JSON line naming the missing key', () => {
    const run = boot({});

    expect(run.status).not.toBe(0);
    expect(bootFailures(run.stderr)).toEqual([
      expect.objectContaining({
        level: 'error',
        event: 'boot_failed',
        reason: 'CORE_READ_KEY is required',
      }),
    ]);
  });

  it(
    'fails with one JSON line when its port is taken',
    async () => {
      occupied = createServer();
      await new Promise<void>((done) => occupied?.listen(0, done));
      const { port } = occupied.address() as AddressInfo;

      const run = boot({
        CORE_READ_KEY: 'dev-core-read-key',
        CORE_EXECUTOR_KEY: 'dev-core-executor-key',
        CORE_MOCK_PORT: String(port),
      });

      expect(run.status).not.toBe(0);
      expect(bootFailures(run.stderr)).toEqual([
        expect.objectContaining({
          level: 'error',
          event: 'boot_failed',
          reason: expect.stringContaining('EADDRINUSE') as unknown,
        }),
      ]);
    },
    BOOT_MS,
  );
});
