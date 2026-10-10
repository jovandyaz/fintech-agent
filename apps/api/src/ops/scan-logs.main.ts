import { text } from 'node:stream/consumers';
import { parseArgs } from 'node:util';

import { runScan } from './run-scan.js';
import { scanLogLines } from './scan-logs.js';

const LINE_BREAK = /\r?\n/;
const USAGE =
  'ops:scan-logs takes no arguments; pipe the log lines to its stdin';

await runScan('ScanLogs', async () => {
  try {
    parseArgs({
      args: process.argv.slice(2),
      strict: true,
      allowPositionals: false,
      options: {},
    });
  } catch {
    throw new Error(USAGE);
  }
  return scanLogLines((await text(process.stdin)).split(LINE_BREAK));
});
