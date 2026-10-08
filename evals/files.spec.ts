import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readIfThere } from './files.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'evals-files-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('readIfThere', () => {
  it('reads a file that is there, and null for one that is not', async () => {
    await writeFile(join(dir, 'a.txt'), 'hola');
    expect(await readIfThere(join(dir, 'a.txt'))).toBe('hola');
    expect(await readIfThere(join(dir, 'missing.txt'))).toBeNull();
  });

  it('throws on any other read error rather than reading it as missing', async () => {
    await expect(readIfThere(dir)).rejects.toMatchObject({ code: 'EISDIR' });
  });
});
