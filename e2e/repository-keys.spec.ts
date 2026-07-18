import { expect, test } from '@playwright/test';

const BASE_URL = process.env.OPENLANDER_BASE_URL ?? 'http://localhost:10114';
const PASSWORD = process.env.OPENLANDER_ADMIN_PASSWORD;

test.describe('Repository Keys settings', () => {
  test.skip(!PASSWORD, 'OPENLANDER_ADMIN_PASSWORD not set');

  test('creates, copies, verifies, and protects an in-use deploy key', async ({ page }) => {
    let status: 'missing' | 'pending' | 'verified' = 'missing';
    const credential = () => ({
      id: 'gitcred_test',
      name: 'Incar deploy key',
      provider: 'github',
      auth_type: 'deploy_key',
      repository_url: 'https://github.com/Team-SpaceY/incar-app',
      repository_key: 'github.com/team-spacey/incar-app',
      public_key: 'ssh-ed25519 AAAATEST openlander:test',
      fingerprint: 'SHA256:test-fingerprint',
      status: status === 'verified' ? 'verified' : 'pending',
      default_branch: status === 'verified' ? 'main' : null,
      last_error_code: null,
      verified_at: status === 'verified' ? '2026-07-18T00:00:00.000Z' : null,
      last_used_at: null,
      created_at: '2026-07-18T00:00:00.000Z',
      updated_at: '2026-07-18T00:00:00.000Z',
      github_setup_url: 'https://github.com/Team-SpaceY/incar-app/settings/keys',
      usage_count: status === 'verified' ? 1 : 0,
      services:
        status === 'verified'
          ? [{ service_id: 'svc_incar', service_name: 'web', project_id: 'incar' }]
          : [],
    });

    await page.addInitScript(() => {
      localStorage.setItem('openlander-language', 'en');
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            (globalThis as unknown as { copied: string }).copied = value;
          },
        },
      });
    });
    await page.route('**/api/git-credentials**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'POST' && url.pathname.endsWith('/verify')) {
        status = 'verified';
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ credential: credential() }),
        });
        return;
      }
      if (request.method() === 'POST') {
        status = 'pending';
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ credential: credential() }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ credentials: status === 'missing' ? [] : [credential()] }),
      });
    });

    await page.goto(`${BASE_URL}/login`);
    await page.locator('input[type="password"]').fill(PASSWORD!);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/projects|\/home|\/overview/);
    await page.goto(`${BASE_URL}/settings/ssh-keys`);

    await page.getByRole('button', { name: 'Add repository key' }).click();
    await page.getByLabel('GitHub repository URL').fill('https://github.com/Team-SpaceY/incar-app');
    await page.getByLabel('Display name (optional)').fill('Incar deploy key');
    await page.getByRole('button', { name: 'Generate key' }).click();
    await expect(page.getByText('Allow write access')).toBeVisible();
    await page.getByRole('button', { name: 'Copy public key' }).click();
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
    await page.getByRole('button', { name: 'Verify connection' }).click();
    await expect(page.getByText('Repository access verified')).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();

    await expect(page.getByText('github.com/team-spacey/incar-app')).toBeVisible();
    await expect(page.getByText('incar/web')).toBeVisible();
    await expect(
      page.getByTitle('Unlink this key from these services before deleting it.'),
    ).toBeDisabled();
  });
});
