import { resolve } from 'node:path';

import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const AGENT_FILE = 'apps/api/src/agent/core/planted.ts';
const EXECUTOR_FILE = 'apps/api/src/executor/planted.ts';
const LINT_MS = 60_000;

// The planted files are not on disk, so the project service cannot type them;
// the G1 rules are syntactic and still come from the real eslint.config.mjs.
const eslint = new ESLint({
  cwd: REPO_ROOT,
  overrideConfig: tseslint.configs.disableTypeChecked,
});

async function g1Errors(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .filter((m) => m.severity === 2 && m.message.includes('G1:'))
    .map((m) => m.message);
}

describe('G1 lint boundary between agent/ and executor/ (02 Process boundary)', () => {
  it.each([
    [
      'a static executor import',
      `import { run } from '../../executor/run.js';\nexport { run };\n`,
    ],
    ['an executor re-export', `export { run } from '../../executor/run.js';\n`],
    [
      'a dynamic executor import',
      `export const load = () => import('../../executor/run.js');\n`,
    ],
    [
      'a static write-client import',
      `import { pay } from '../../clients/core-write-client.js';\nexport { pay };\n`,
    ],
    [
      'a dynamic write-client import',
      `export const load = () => import('../../clients/core-write-client.js');\n`,
    ],
    [
      'a computed dynamic import',
      `export const load = (path: string) => import(path);\n`,
    ],
  ])(
    'fails on %s planted in agent/',
    async (_, code) => {
      expect(await g1Errors(AGENT_FILE, code)).not.toEqual([]);
    },
    LINT_MS,
  );

  it.each([
    [
      'a static agent import',
      `import { harness } from '../agent/core/harness.js';\nexport { harness };\n`,
    ],
    [
      'a dynamic agent import',
      `export const load = () => import('../agent/core/harness.js');\n`,
    ],
    [
      'a computed dynamic import',
      `export const load = (path: string) => import(path);\n`,
    ],
  ])(
    'fails on %s planted in executor/',
    async (_, code) => {
      expect(await g1Errors(EXECUTOR_FILE, code)).not.toEqual([]);
    },
    LINT_MS,
  );

  it.each([
    [
      'a .mts agent file',
      'apps/api/src/agent/core/planted.mts',
      `export const load = () => import('../../executor/run.js');\n`,
    ],
    [
      'a .tsx agent file',
      'apps/api/src/agent/core/planted.tsx',
      `import { run } from '../../executor/run.js';\nexport { run };\n`,
    ],
    [
      'a .cts executor file',
      'apps/api/src/executor/planted.cts',
      `import { harness } from '../agent/core/harness.js';\nexport { harness };\n`,
    ],
    [
      'createRequire in agent/',
      AGENT_FILE,
      `import { createRequire } from 'node:module';\nexport const load = () => createRequire(import.meta.url)('../../executor/run.js');\n`,
    ],
    [
      'a module namespace in executor/',
      EXECUTOR_FILE,
      `import * as module from 'module';\nexport const load = () => module.createRequire(import.meta.url)('../agent/core/harness.js');\n`,
    ],
    [
      'getBuiltinModule in agent/',
      AGENT_FILE,
      `export const load = () => process.getBuiltinModule('node:module').createRequire(import.meta.url)('../../executor/run.js');\n`,
    ],
    [
      'an inline disable in agent/',
      AGENT_FILE,
      `// eslint-disable-next-line no-restricted-imports\nimport { run } from '../../executor/run.js';\nexport { run };\n`,
    ],
    [
      'an inline disable in executor/',
      EXECUTOR_FILE,
      `/* eslint-disable */\nexport const load = () => import('../agent/core/harness.js');\n`,
    ],
  ])(
    'fails on %s',
    async (_, file, code) => {
      expect(await g1Errors(file, code)).not.toEqual([]);
    },
    LINT_MS,
  );

  it(
    'passes an agent file that imports only the contracts',
    async () => {
      expect(
        await g1Errors(
          AGENT_FILE,
          `import { maskPii } from '@fintech-agent/contracts';\nexport const mask = maskPii;\n`,
        ),
      ).toEqual([]);
    },
    LINT_MS,
  );
});
