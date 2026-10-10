import { LogAlertSchema, ScanFailedLineSchema } from '@fintech-agent/contracts';
import { describe, expect, it } from 'vitest';

import { CLI_TIMEOUT_MS, linesOf, runApiCli } from '../../test/cli.js';

const EXIT = { clean: 0, alerts: 1, failed: 2 } as const;
const MCP_LISTENING = '{"event":"mcp_listening","port":3020}';
const UNRECORDED = '{"event":"security_event_unrecorded"}';
const CLABE = '002010077777777771';
const HOSTILE_DEPTH = 10_000;
const USAGE =
  'ops:scan-logs takes no arguments; pipe the log lines to its stdin';

const scan = (
  input: string,
  args: string[] = [],
): ReturnType<typeof runApiCli> =>
  runApiCli('src/ops/scan-logs.main.ts', { args, input });

describe('pnpm ops:scan-logs', () => {
  it(
    'reads the log from stdin, prints each alert as one JSON line and exits 1',
    () => {
      const run = scan(
        `${MCP_LISTENING}\r\nERROR:  Key (clabe)=(${CLABE}) already exists.\n`,
      );

      expect(run.status).toBe(EXIT.alerts);
      expect(linesOf(run.stdout, LogAlertSchema)).toEqual([
        { alert: 'pii_in_logs', line: 2 },
      ]);
      expect(run.stdout).not.toContain(CLABE.slice(-4));
    },
    CLI_TIMEOUT_MS,
  );

  it(
    'prints nothing and exits 0 over a clean log',
    () => {
      const run = scan(`${MCP_LISTENING}\n`);

      expect([run.status, run.stdout]).toEqual([EXIT.clean, '']);
    },
    CLI_TIMEOUT_MS,
  );

  it(
    'reports a line nested too deep to read and still the lines after it',
    () => {
      const deep = `${'{"a":'.repeat(HOSTILE_DEPTH)}1${'}'.repeat(HOSTILE_DEPTH)}`;

      const run = scan(`${deep}\n${UNRECORDED}\n`);

      expect(run.status).toBe(EXIT.alerts);
      expect(linesOf(run.stdout, LogAlertSchema)).toEqual([
        { alert: 'pii_in_logs', line: 1 },
        { alert: 'security_event_unrecorded', line: 2 },
      ]);
    },
    CLI_TIMEOUT_MS,
  );

  it.each([[['--since=5m']], [['logs.txt']]])(
    'refuses %j with a short usage line and exits 2',
    (args) => {
      const run = scan(`${UNRECORDED}\n`, args);

      expect([run.status, run.stdout]).toEqual([EXIT.failed, '']);
      expect(linesOf(run.stderr, ScanFailedLineSchema)).toEqual([
        expect.objectContaining({ reason: USAGE }),
      ]);
    },
    CLI_TIMEOUT_MS,
  );
});
