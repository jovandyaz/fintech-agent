import { defineConfig } from 'vitest/config';

// `unit` needs nothing running; `integration` starts Postgres through
// Testcontainers (Docker, no API key), and so do the in-process end-to-end
// specs; `console` runs the React app's specs in jsdom. `pnpm verify` runs unit
// and console.
export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['{apps,packages,data,evals}/**/*.spec.ts'],
          exclude: [
            '**/*.int.spec.ts',
            '**/*.e2e.spec.ts',
            '**/node_modules/**',
            'apps/console/**',
          ],
        },
      },
      'apps/console',
      {
        test: {
          name: 'integration',
          include: [
            '{apps,packages,data,evals}/**/*.int.spec.ts',
            '{apps,packages,data,evals}/**/*.e2e.spec.ts',
          ],
          exclude: ['**/node_modules/**'],
        },
      },
    ],
  },
});
