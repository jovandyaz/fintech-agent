import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { fromCallerDir } from '../files.js';
import { carryLabelFiles } from './carry.js';

const CALIBRATION_DIR = import.meta.dirname;
const USAGE = 'usage: pnpm eval:carry-labels <old calibration dir>';

async function main(): Promise<void> {
  const { positionals } = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    allowPositionals: true,
  });
  const [oldDir] = positionals;
  if (positionals.length !== 1 || oldDir === undefined) throw new Error(USAGE);
  await carryLabelFiles({
    oldDir: fromCallerDir(oldDir),
    dir: resolve(CALIBRATION_DIR),
    log: (line) => console.log(line),
  });
}

if (process.argv[1] === import.meta.filename) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
