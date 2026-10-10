import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { resolve } from 'node:path';

import type { z } from 'zod';

const API_DIR = resolve(import.meta.dirname, '..');

/** Upper bound for one api CLI run under tsx in a test. */
export const CLI_TIMEOUT_MS = 30_000;

export interface CliRun {
  args?: readonly string[];
  env?: Record<string, string>;
  input?: string;
}

/** Runs an api CLI under tsx as its package script does, with only PATH and `env` set. */
export function runApiCli(
  script: string,
  { args = [], env = {}, input }: CliRun = {},
): SpawnSyncReturns<string> {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', resolve(API_DIR, script), ...args],
    {
      cwd: API_DIR,
      env: { PATH: process.env.PATH, ...env },
      ...(input === undefined ? {} : { input }),
      encoding: 'utf8',
      timeout: CLI_TIMEOUT_MS,
    },
  );
}

/** Each printed line parsed with `schema`; throws on a line that is not one. */
export const linesOf = <T>(text: string, schema: z.ZodType<T>): T[] =>
  text
    .trim()
    .split('\n')
    .map((line) => schema.parse(JSON.parse(line)));
