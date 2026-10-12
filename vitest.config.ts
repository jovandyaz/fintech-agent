import { defineConfig } from 'vitest/config';

// `unit` needs nothing running; `integration` starts Postgres through
// Testcontainers (Docker, no API key), and so do the in-process end-to-end
// specs; `console` runs the React app's specs in jsdom. `pnpm verify` runs unit
// and console.

// Testcontainers waits a fixed 10 s for a started container's port to bind;
// many suites starting Postgres at once exceed it. The cap needs its own
// group, so `pnpm test` runs integration after unit and console.
const INTEGRATION_MAX_WORKERS = 4;

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['{apps,packages,data,evals,scripts}/**/*.spec.ts'],
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
          maxWorkers: INTEGRATION_MAX_WORKERS,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
