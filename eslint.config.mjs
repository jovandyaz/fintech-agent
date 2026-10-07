// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const AGENT_TO_EXECUTOR =
  'G1: the agent module must not import the executor (specs/02-security.md).';
const AGENT_TO_WRITE_CLIENT =
  'G1: only the executor may hold the core-mock write client (specs/02-security.md).';
const EXECUTOR_TO_AGENT =
  'G1: the executor must not import the agent module (specs/02-security.md).';

// no-restricted-imports sees only static imports and re-exports.
const dynamicImportOf = (segment, message) => ({
  selector: `ImportExpression[source.value=/(^|\\/)${segment}(\\/|\\.js$|$)/]`,
  message,
});
const COMPUTED_DYNAMIC_IMPORT = {
  selector: "ImportExpression[source.type!='Literal']",
  message:
    'G1: a dynamic import here takes a literal path, so the boundary rules can check it (specs/02-security.md).',
};

const LOAD_THROUGH_IMPORT =
  'G1: load modules through import, so the boundary rules can check them (specs/02-security.md).';

// createRequire and getBuiltinModule load a module no import rule sees.
const MODULE_LOADERS = ['module', 'node:module'].map((name) => ({
  name,
  message: LOAD_THROUGH_IMPORT,
}));
const BUILTIN_MODULE_LOOKUP = {
  selector: "MemberExpression[property.name='getBuiltinModule']",
  message: LOAD_THROUGH_IMPORT,
};

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '.superpowers/**',
      'docs/agent-setup/**',
    ],
  },
  {
    files: ['**/*.{js,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // 02 G1: the process running the model has no write path. Nothing under
    // the agent module may import the executor or the core-mock write client.
    files: ['apps/api/src/agent/**/*.{ts,tsx,mts,cts}'],
    linterOptions: { noInlineConfig: true },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: MODULE_LOADERS,
          patterns: [
            {
              group: ['**/executor', '**/executor/**'],
              message: AGENT_TO_EXECUTOR,
            },
            {
              group: [
                '**/core-write-client',
                '**/core-write-client.js',
                '**/core-write-client/**',
              ],
              message: AGENT_TO_WRITE_CLIENT,
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        dynamicImportOf('executor', AGENT_TO_EXECUTOR),
        dynamicImportOf('core-write-client', AGENT_TO_WRITE_CLIENT),
        COMPUTED_DYNAMIC_IMPORT,
        BUILTIN_MODULE_LOOKUP,
      ],
    },
  },
  {
    // 02 G1, the other direction: the executor never imports the agent module.
    files: ['apps/api/src/executor/**/*.{ts,tsx,mts,cts}'],
    linterOptions: { noInlineConfig: true },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: MODULE_LOADERS,
          patterns: [
            {
              group: ['**/agent', '**/agent/**'],
              message: EXECUTOR_TO_AGENT,
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        dynamicImportOf('agent', EXECUTOR_TO_AGENT),
        COMPUTED_DYNAMIC_IMPORT,
        BUILTIN_MODULE_LOOKUP,
      ],
    },
  },
);
