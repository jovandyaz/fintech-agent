import { defineConfig, devices } from '@playwright/test';

import { CONSOLE_URL } from './stack.js';

// A case waits on the worker's and the executor's polling, so the bounds are
// minutes, not the browser's default seconds.
const TEST_TIMEOUT_MS = 180_000;
const EXPECT_TIMEOUT_MS = 60_000;

export default defineConfig({
  testDir: '.',
  testMatch: '*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: TEST_TIMEOUT_MS,
  expect: { timeout: EXPECT_TIMEOUT_MS },
  outputDir: 'test-results',
  use: {
    baseURL: CONSOLE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
