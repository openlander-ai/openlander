/**
 * Playwright config for one-off live-instance smoke tests.
 *
 * Skips the quality-gate globalSetup so it does not try to setup-password
 * or seed test repos against the user's running instance. Use for specs
 * under e2e/ that drive the live server with credentials supplied via env.
 *
 *   OPENLANDER_ADMIN_PASSWORD='…' npx playwright test \
 *     --config=playwright-live.config.ts e2e/concurrent-deploy.spec.ts
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: [
    'concurrent-deploy.spec.ts',
    'c1-newproject.spec.ts',
    'c3-recovery-rollback-bluegreen.spec.ts',
    'c4-danger-actions.spec.ts',
    'c5-opscenter.spec.ts',
    'c7-dashboard-list.spec.ts',
    'repository-keys.spec.ts',
    'protected-share.spec.ts',
  ],
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.OPENLANDER_BASE_URL ?? 'http://localhost:10114',
    ...devices['Desktop Chrome'],
  },
});
