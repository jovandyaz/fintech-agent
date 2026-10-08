import { readFile } from 'node:fs/promises';

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
