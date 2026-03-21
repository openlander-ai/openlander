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
  projects: [
    {
      name: 'e2e',
      testDir: './e2e',
    },
    {
      name: 'web',
      testDir: './web/test',
    },
  ],
});
