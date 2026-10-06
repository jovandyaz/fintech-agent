import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../format.mjs', import.meta.url));
const REPO = dirname(dirname(dirname(SCRIPT)));
const dirs = [];
after(() =>
  dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })),
);

function recordingPnpm() {
  const dir = mkdtempSync(join(tmpdir(), 'format-hook-bin-'));
  dirs.push(dir);
  const log = join(dir, 'calls.log');
  writeFileSync(join(dir, 'pnpm'), `#!/bin/sh\necho "$PWD|$*" >> "${log}"\n`);
  chmodSync(join(dir, 'pnpm'), 0o755);
  return { dir, calls: () => readFileSync(log, 'utf8').trim().split('\n') };
}

function runHook(payload, binDir) {
  return spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH}` },
  });
}

test('a file in the repo is formatted with prettier from the repo root', () => {
  const pnpm = recordingPnpm();
  const file = join(REPO, 'apps/api/src/cases/cases.ts');
  const result = runHook(
    { tool_name: 'Edit', tool_input: { file_path: file } },
    pnpm.dir,
  );
  assert.equal(result.status, 0);
  assert.deepEqual(pnpm.calls(), [
    `${REPO}|exec prettier --write --ignore-unknown ${file}`,
  ]);
});

test('a file outside the repo is left alone', () => {
  const pnpm = recordingPnpm();
  const result = runHook(
    { tool_name: 'Write', tool_input: { file_path: '/elsewhere/notes.md' } },
    pnpm.dir,
  );
  assert.equal(result.status, 0);
  assert.throws(() => pnpm.calls(), /ENOENT/);
});

test('a formatter failure never fails the tool call', () => {
  const dir = mkdtempSync(join(tmpdir(), 'format-hook-bin-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'pnpm'), '#!/bin/sh\nexit 1\n');
  chmodSync(join(dir, 'pnpm'), 0o755);
  const result = runHook(
    { tool_name: 'Edit', tool_input: { file_path: join(REPO, 'a.ts') } },
    dir,
  );
  assert.equal(result.status, 0);
});
