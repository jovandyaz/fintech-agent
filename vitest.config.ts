import { defineConfig } from 'vitest/config';

// `unit` needs nothing running; `integration` starts Postgres through
// Testcontainers (Docker, no API key). `pnpm verify` runs unit only.
export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['{apps,packages,evals}/**/*.spec.ts'],
          exclude: ['**/*.int.spec.ts', '**/node_modules/**'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['{apps,packages,evals}/**/*.int.spec.ts'],
          exclude: ['**/node_modules/**'],
        },
      },
    ],
  },
});
