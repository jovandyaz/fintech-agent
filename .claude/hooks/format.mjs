#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function main() {
  let filePath;
  try {
    filePath = JSON.parse(readFileSync(0, 'utf8'))?.tool_input?.file_path;
  } catch {
    return;
  }
  if (typeof filePath !== 'string') return;
  const absolute = resolve(filePath);
  if (relative(REPO_ROOT, absolute).startsWith('..')) return;

  spawnSync(
    'pnpm',
    ['exec', 'prettier', '--write', '--ignore-unknown', absolute],
    { cwd: REPO_ROOT, stdio: 'ignore' },
  );
}

main();
