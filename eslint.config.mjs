// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

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
    files: ['**/*.ts', '**/*.tsx'],
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
    files: ['apps/api/src/agent/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/executor', '**/executor/**'],
              message:
                'G1: the agent module must not import the executor (specs/02-security.md).',
            },
            {
              group: ['**/core-write-client', '**/core-write-client/**'],
              message:
                'G1: only the executor may hold the core-mock write client (specs/02-security.md).',
            },
          ],
        },
      ],
    },
  },
);
