import { SCAN_FAILED_EVENT } from '@fintech-agent/contracts';
import { Logger } from '@nestjs/common';

import { reasonOf } from '../common/errors/reason-of.js';
import { JsonConsoleLogger } from '../common/logging/json-console-logger.js';

const SCAN_EXIT = { clean: 0, alerts: 1, failed: 2 } as const;

/**
 * Runs one ops scan as a CLI: each alert is one JSON line on stdout, and the
 * exit code says clean, alerts or failed. A failure is one masked log line on
 * stderr, so a scan that could not run is never read as a clean one.
 */
export async function runScan(
  context: string,
  scan: () => Promise<readonly object[]>,
): Promise<void> {
  Logger.overrideLogger(new JsonConsoleLogger());
  try {
    const alerts = await scan();
    process.stdout.write(
      alerts.map((alert) => `${JSON.stringify(alert)}\n`).join(''),
    );
    process.exitCode = alerts.length > 0 ? SCAN_EXIT.alerts : SCAN_EXIT.clean;
  } catch (error) {
    new Logger(context).fatal({
      event: SCAN_FAILED_EVENT,
      reason: reasonOf(error),
    });
    process.exitCode = SCAN_EXIT.failed;
  }
}
