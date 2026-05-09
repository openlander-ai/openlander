import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:10114',
    trace: 'on-first-retry',
    ...devices['Desktop Chrome'],
  },
  globalSetup: './e2e/quality-gate/global-setup.ts',
  globalTeardown: './e2e/quality-gate/global-teardown.ts',
  projects: [
    {
      name: 'e2e',
      testDir: './e2e',
    },
    {
      name: 'web',
      testDir: './web/test',
    },
    {
      name: 'quality-gate',
      testDir: './e2e/quality-gate',
      timeout: 300_000,
      expect: { timeout: 60_000 },
      use: { baseURL: 'http://localhost:10114' },
      workers: 1,
      retries: 0,
    },
  ],
});
