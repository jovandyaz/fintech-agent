import { ScanFailedLineSchema } from '@fintech-agent/contracts';
import { describe, expect, it } from 'vitest';

import { CLI_TIMEOUT_MS, linesOf, runApiCli } from '../../test/cli.js';

const EXIT_FAILED = 2;

describe('pnpm ops:scan-traces arguments', () => {
  it.each([
    [
      ['--since', 'yesterday'],
      '--since takes an ISO instant with Z or an offset',
    ],
    [['--until', 'now'], 'ops:scan-traces takes only --since <ISO instant>'],
  ])(
    'refuses %j before reading the database, with one short line, and exits 2',
    (args, reason) => {
      const run = runApiCli('src/ops/scan-traces.main.ts', { args });

      expect([run.status, run.stdout]).toEqual([EXIT_FAILED, '']);
      expect(linesOf(run.stderr, ScanFailedLineSchema)).toEqual([
        expect.objectContaining({ reason }),
      ]);
    },
    CLI_TIMEOUT_MS,
  );
});
