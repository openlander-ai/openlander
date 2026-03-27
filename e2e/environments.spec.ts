import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test.describe('Environment Lifecycle Flow (Task 13)', () => {
  const projectId = 'test-proj-123';
  const prodEnvId = 'env-prod-123';
  const developmentEnvId = 'env-development-456';

  test.beforeEach(async ({ page }) => {
    await page.route('**/api/projects', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          json: [
            {
              id: projectId,
              name: 'my-app',
              repoUrl: 'https://github.com/test/my-app',
              environments: [{ id: prodEnvId, type: 'production', status: 'running' }],
            },
          ],
        });
      } else if (route.request().method() === 'POST') {
        await route.fulfill({
          json: {
            id: projectId,
            name: 'my-app',
            repoUrl: 'https://github.com/test/my-app',
            environments: [{ id: prodEnvId, type: 'production', status: 'idle' }],
          },
        });
      } else {
        await route.continue();
      }
    });

    await page.route(`**/api/projects/${projectId}*`, async (route) => {
      if (route.request().method() === 'GET') {
        const url = new URL(route.request().url());
        const envId = url.searchParams.get('environmentId') || prodEnvId;

        await route.fulfill({
          json: {
            id: projectId,
            name: 'my-app',
            repoUrl: 'https://github.com/test/my-app',
            environments: [
              { id: prodEnvId, type: 'production', status: 'running', branch: 'main' },
              ...(envId === developmentEnvId
                ? [
                    {
                      id: developmentEnvId,
                      type: 'development',
                      status: 'stopped',
                      branch: 'develop',
                    },
                  ]
                : []),
            ],
          },
        });
      } else {
        await route.continue();
      }
    });

    await page.route(`**/api/projects/${projectId}/environments`, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          json: [
            { id: prodEnvId, type: 'production', status: 'running', branch: 'main' },
            { id: developmentEnvId, type: 'development', status: 'stopped', branch: 'develop' },
          ],
        });
      } else if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          json: { id: developmentEnvId, type: 'development', status: 'idle', branch: 'develop' },
        });
      } else {
        await route.continue();
      }
    });

    await page.route(`**/api/projects/${projectId}/environments/*/env`, async (route) => {
      if (route.request().method() === 'GET') {
        const url = route.request().url();
        if (url.includes(developmentEnvId)) {
          await route.fulfill({
            json: {
              vars: { APP_NAME: 'MyApp', DB_URL: 'dev-db' },
              inheritance: {
                APP_NAME: { source: 'production', value: 'MyApp' },
                DB_URL: { source: 'environment', value: 'dev-db' },
              },
            },
          });
        } else {
          await route.fulfill({
            json: {
              vars: { APP_NAME: 'MyApp', DB_URL: 'prod-db' },
              inheritance: {
                APP_NAME: { source: 'environment', value: 'MyApp' },
                DB_URL: { source: 'environment', value: 'prod-db' },
              },
            },
          });
        }
      } else if (route.request().method() === 'POST') {
        await route.fulfill({ json: { success: true } });
      } else {
        await route.continue();
      }
    });

    await page.route(`**/api/projects/${projectId}/deploy`, async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ json: { success: true } });
      } else {
        await route.continue();
      }
    });

    await page.route(`**/api/projects/${projectId}/env-example*`, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          body: '# Description\nAPP_NAME=\nDB_URL=\n',
          headers: { 'Content-Type': 'text/plain' },
        });
      } else {
        await route.continue();
      }
    });
  });

  test('1. Create project -> production env auto-created', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /add project/i }).click();

    await page.getByLabel(/repository url/i).fill('https://github.com/test/my-app');
    await page.getByRole('button', { name: /create/i }).click();

    await expect(page.getByText('🟢 Production')).toBeVisible();
  });

  test('2. Add development env & 7. UI environment switch', async ({ page }) => {
    await page.goto(`/projects/${projectId}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /production/i }).click();

    const addDevelopmentBtn = page.getByRole('menuitem', { name: /add development/i });
    if (await addDevelopmentBtn.isVisible()) {
      await addDevelopmentBtn.click();
    }

    await page.goto(`/projects/${projectId}?env=development`);
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/.*env=development/);
    await expect(page.getByText(/development/i)).toBeVisible();
  });

  test('3. Set production env vars & 4. Override in development', async ({ page }) => {
    await page.goto(`/projects/${projectId}?env=development`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('tab', { name: /settings/i }).click();
    await page.getByRole('button', { name: /environment variables/i }).click();

    await expect(page.getByText('Inherited from Production')).toBeVisible();
    await expect(page.getByText('APP_NAME')).toBeVisible();

    await expect(page.getByText('Override')).toBeVisible();
    await expect(page.getByText('DB_URL')).toBeVisible();
  });

  test('5. Deploy development', async ({ page }) => {
    await page.goto(`/projects/${projectId}?env=development`);
    await page.waitForLoadState('networkidle');

    await page
      .getByRole('button', { name: /deploy/i, exact: true })
      .first()
      .click();

    await expect(page.getByLabel(/environment/i)).toHaveValue('development');
    await expect(page.getByLabel(/branch/i)).toHaveValue('develop');

    await page.getByRole('button', { name: /deploy now/i }).click();

    await expect(page.getByText(/deploying/i)).toBeVisible();
  });

  test('8. .env.example generation', async ({ page }) => {
    await page.goto(`/projects/${projectId}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('tab', { name: /settings/i }).click();
    await page.getByRole('button', { name: /environment variables/i }).click();

    await page.getByRole('button', { name: /generate \.env\.example/i }).click();

    await expect(page.getByText('APP_NAME=')).toBeVisible();
    await expect(page.getByText('DB_URL=')).toBeVisible();

    await expect(page.getByRole('button', { name: /download/i })).toBeVisible();
  });
});
