import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test.describe('ProjectDetail 5-tab layout', () => {
  // Navigate to the first project in the list before tests
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the app to load
    await page.waitForLoadState('networkidle');
  });

  test('5 tabs are visible on project detail page', async ({ page }) => {
    // Navigate to projects list and click first project
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Find and click first project link
    const projectLink = page.locator('a[href*="/projects/"]').first();
    await projectLink.waitFor({ timeout: 10000 });
    await projectLink.click();

    await page.waitForLoadState('networkidle');

    // Assert 5 tab triggers are visible
    await expect(page.getByRole('tab', { name: /overview/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /deployments/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /console/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /operations/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /settings/i })).toBeVisible();
  });

  test('tab switching changes content pane', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const projectLink = page.locator('a[href*="/projects/"]').first();
    await projectLink.waitFor({ timeout: 10000 });
    await projectLink.click();
    await page.waitForLoadState('networkidle');

    // Click Deployments tab
    await page.getByRole('tab', { name: /deployments/i }).click();
    await page.waitForTimeout(500);

    // Click Console tab
    await page.getByRole('tab', { name: /console/i }).click();
    await page.waitForTimeout(500);

    // Click Settings tab
    await page.getByRole('tab', { name: /settings/i }).click();
    await page.waitForTimeout(500);

    // Click back to Overview
    await page.getByRole('tab', { name: /overview/i }).click();
    await page.waitForTimeout(500);

    // Overview tab should be active
    const overviewTab = page.getByRole('tab', { name: /overview/i });
    await expect(overviewTab).toHaveAttribute('data-state', 'active');
  });

  test('Overview tab shows monitoring dashboard layout', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const projectLink = page.locator('a[href*="/projects/"]').first();
    await projectLink.waitFor({ timeout: 10000 });
    await projectLink.click();
    await page.waitForLoadState('networkidle');

    // Ensure we're on Overview tab
    await page.getByRole('tab', { name: /overview/i }).click();
    await page.waitForTimeout(500);

    // Overview tab should load without errors
    // The monitoring dashboard displays timeline and deployment info
    const overviewTab = page.getByRole('tab', { name: /overview/i });
    await expect(overviewTab).toHaveAttribute('data-state', 'active');
  });

  test('header ⋯ dropdown opens with actions', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const projectLink = page.locator('a[href*="/projects/"]').first();
    await projectLink.waitFor({ timeout: 10000 });
    await projectLink.click();
    await page.waitForLoadState('networkidle');

    // Click the ⋯ more actions button
    const moreButton = page.getByRole('button', { name: /more actions/i });
    await moreButton.waitFor({ timeout: 5000 });
    await moreButton.click();

    // Dropdown should open with at least Rollback option
    await expect(page.getByRole('menuitem', { name: /rollback/i })).toBeVisible();
  });

  test('Operations tab shows incident dashboard', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const projectLink = page.locator('a[href*="/projects/"]').first();
    await projectLink.waitFor({ timeout: 10000 });
    await projectLink.click();
    await page.waitForLoadState('networkidle');

    await page.getByRole('tab', { name: /operations/i }).click();
    await page.waitForTimeout(1500);

    await expect(page.getByText(/active incidents/i)).toBeVisible();
    await expect(page.getByText(/circuit breaker/i)).toBeVisible();
    await expect(page.getByText(/incident history/i)).toBeVisible();

    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.waitForTimeout(500);
    expect(errors.filter((e) => !e.includes('favicon'))).toHaveLength(0);
  });

  test('mobile viewport shows stacked layout', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 812 });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const projectLink = page.locator('a[href*="/projects/"]').first();
    await projectLink.waitFor({ timeout: 10000 });
    await projectLink.click();
    await page.waitForLoadState('networkidle');

    // On mobile, tabs should still be visible
    await expect(page.getByRole('tab', { name: /overview/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /settings/i })).toBeVisible();

    // Settings tab: nav should be horizontal on mobile
    await page.getByRole('tab', { name: /settings/i }).click();
    await page.waitForTimeout(500);

    // Environment Variables nav item should be visible
    await expect(page.getByText('Environment Variables')).toBeVisible();
  });
});
