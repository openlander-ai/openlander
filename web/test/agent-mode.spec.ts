import { test, expect } from '@playwright/test';

test.describe('Built-in agent mode disabled in 0.1', () => {
  test('agent route redirects to home', async ({ page }) => {
    await page.goto('/agent');
    await expect(page).toHaveURL(/\/home/);
  });

  test('dashboard does not expose the old agent mode toggle', async ({ page }) => {
    await page.goto('/projects');
    await expect(page.getByTestId('mode-toggle')).toHaveCount(0);
    await expect(page.getByTestId('mode-toggle-agent')).toHaveCount(0);
  });
});
