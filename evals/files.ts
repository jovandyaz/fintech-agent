import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const NOT_FOUND = 'ENOENT';

/** The file's text, or null when it does not exist; any other read error throws. */
export async function readIfThere(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === NOT_FOUND) return null;
    throw error;
  }
}

/** A path a CLI was given, resolved against the directory `pnpm` was called from (its `INIT_CWD`), not the package it runs in. */
export const fromCallerDir = (
  path: string,
  env: NodeJS.ProcessEnv = process.env,
): string => resolve(env['INIT_CWD'] ?? process.cwd(), path);
