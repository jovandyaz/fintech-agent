import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const SCANNED_DIRS = [
  'apps',
  'packages',
  'data',
  'evals',
  'ops',
  'specs',
  'docs',
  '.claude',
];
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'coverage']);
const TEXT_FILE =
  /(?:\.(?:[cm]?[jt]sx?|json|md|ya?ml|sql|html|css|sh)|^Dockerfile|^\.env\.example)$/;
const INVISIBLE =
  /\p{Default_Ignorable_Code_Point}|\p{Cf}|\p{Zl}|\p{Zp}|\u2800|(?![\n\t\r])\p{Cc}/u;

const isMissing = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

function* textFiles(dir: string, recursive = true): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    // A folder the build plan has not reached yet; anything else must fail.
    if (isMissing(error)) return;
    throw error;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive && !SKIPPED_DIRS.has(entry.name)) yield* textFiles(path);
    } else if (TEXT_FILE.test(entry.name)) {
      yield path;
    }
  }
}

describe('source hygiene', () => {
  // An invisible character in code or a fixture changes what a test means
  // without showing in review; tests build them with escapes instead.
  it('holds no zero-width, bidi, Tag or other format character in any text file', () => {
    const dirty = [
      ...textFiles(REPO_ROOT, false),
      ...SCANNED_DIRS.flatMap((dir) => [...textFiles(join(REPO_ROOT, dir))]),
    ]
      .filter((path) => INVISIBLE.test(readFileSync(path, 'utf8')))
      .map((path) => relative(REPO_ROOT, path));
    expect(dirty).toEqual([]);
  });
});
