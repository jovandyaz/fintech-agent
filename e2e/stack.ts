import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

import postgres from 'postgres';

/** The repository root, where the compose file and `.env.example` live. */
export const REPO_ROOT = resolve(import.meta.dirname, '..');

const env: Record<string, string | undefined> = {
  ...parseEnv(readFileSync(resolve(REPO_ROOT, '.env.example'), 'utf8')),
  ...process.env,
};

function required(name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set in .env.example`);
  return value;
}

/** The console's origin, served by its nginx on CONSOLE_PORT. */
export const CONSOLE_URL = `http://localhost:${required('CONSOLE_PORT')}`;

/** The first operator's dev token from OPERATOR_TOKENS (`name:keyId:token,…`). */
export function operatorToken(): string {
  const [first] = required('OPERATOR_TOKENS').split(',');
  const token = first?.split(':')[2];
  if (!token) throw new Error('OPERATOR_TOKENS has no operator token');
  return token;
}

/** The compose database as its owner, to check what the executor wrote. */
export const database = (): postgres.Sql =>
  postgres(required('DATABASE_URL'), { max: 1, onnotice: () => undefined });

/** Runs a repo command (pnpm or docker compose) and returns its stdout. */
export function run(
  command: string,
  args: readonly string[],
  extraEnv: Record<string, string> = {},
): string {
  return execFileSync(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  });
}

/** How many `core_write` lines core-mock's log holds for an action id (needs the compose stack). */
export function coreWritesFor(actionId: string): number {
  // Compose reads .env on its own, which may hold a real key; this run needs none.
  const logs = run('docker', [
    'compose',
    '--env-file',
    '/dev/null',
    'logs',
    '--no-color',
    'core-mock',
  ]);
  return logs
    .split('\n')
    .filter(
      (line) => line.includes('"core_write"') && line.includes(`"${actionId}"`),
    ).length;
}
