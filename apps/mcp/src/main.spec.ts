import { spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const SECRET = 'mcp-spec-secret-not-real';
const BOOT_MS = 10_000;

const ENV = {
  CORE_MOCK_URL: 'http://localhost:3010',
  CORE_READ_KEY: `read-${SECRET}`,
  CASE_TOKEN_KEY: `case-token-key-${SECRET}`,
  MCP_AUDIENCE: 'http://mcp:3020/mcp',
  MCP_DATABASE_URL: `postgresql://copilot_mcp:${SECRET}@localhost:5433/copilot`,
};

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
      env: { PATH: process.env.PATH, ...env },
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

describe('mcp boot', () => {
  it('fails with one JSON line that echoes no secret when its config is wrong', () => {
    const run = boot({
      ...ENV,
      MCP_DATABASE_URL: `postgresql://copilot_mcp:${SECRET}@db host/copilot`,
    });

    expect(run.status).not.toBe(0);
    expect(bootFailures(run.stderr)).toEqual([
      expect.objectContaining({ level: 'error', event: 'boot_failed' }),
    ]);
    expect(run.stderr).not.toContain(SECRET);
  });

  it(
    'fails with one JSON line when its port is taken',
    async () => {
      occupied = createServer();
      await new Promise<void>((done) => occupied?.listen(0, done));
      const { port } = occupied.address() as AddressInfo;

      const run = boot({ ...ENV, MCP_PORT: String(port) });

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
