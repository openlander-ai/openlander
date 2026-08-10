/**
 * Protected-share live E2E.
 *
 * Run against an already shared Application:
 *
 *   OPENLANDER_PROTECTED_SHARE_URL='https://app.example.com' \
 *   OPENLANDER_PROTECTED_SHARE_CODE='XXXX-XXXX' \
 *   npx playwright test --config=playwright-live.config.ts e2e/protected-share.spec.ts
 */
import { devices, expect, test } from '@playwright/test';

const SHARE_URL = process.env.OPENLANDER_PROTECTED_SHARE_URL?.replace(/\/$/, '');
const SHARE_CODE = process.env.OPENLANDER_PROTECTED_SHARE_CODE;
const iphone13 = devices['iPhone 13'];

test.describe('protected share request policy', () => {
  test.skip(!SHARE_URL || !SHARE_CODE, 'Protected-share URL and code are required');

  test('redirects direct verify visits and distinguishes embedded from cross-site posts', async ({
    request,
  }) => {
    const verifyUrl = `${SHARE_URL!}/__openlander/share/verify`;
    const direct = await request.get(verifyUrl, { maxRedirects: 0 });
    expect(direct.status()).toBe(303);
    expect(direct.headers()['location']).toBe('/');

    const embedded = await request.post(verifyUrl, {
      headers: {
        Origin: 'null',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Dest': 'document',
      },
      form: { access_code: 'WRONG-CODE' },
    });
    expect(embedded.status()).toBe(401);

    const crossSite = await request.post(verifyUrl, {
      headers: {
        Origin: 'null',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Dest': 'document',
      },
      form: { access_code: 'WRONG-CODE' },
    });
    expect(crossSite.status()).toBe(403);
  });
});

test.describe('protected share mobile visitor flow', () => {
  test.skip(!SHARE_URL || !SHARE_CODE, 'Protected-share URL and code are required');
  test.use({
    viewport: iphone13.viewport,
    userAgent: iphone13.userAgent,
    deviceScaleFactor: iphone13.deviceScaleFactor,
    isMobile: iphone13.isMobile,
    hasTouch: iphone13.hasTouch,
  });

  test('fits the mobile viewport, authenticates, and keeps the signed session', async ({
    context,
    page,
  }) => {
    const accessCodeInput = page.locator('input[name="access_code"]');
    const verifyButton = page.locator(
      'form[action="/__openlander/share/verify"] button[type="submit"]',
    );
    const response = await page.goto(`${SHARE_URL!}/`);
    expect(response?.status()).toBe(401);
    await expect(accessCodeInput).toBeVisible();
    await expect(verifyButton).toBeVisible();
    expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(
      true,
    );

    await accessCodeInput.fill(SHARE_CODE!);
    await verifyButton.click();
    await expect(accessCodeInput).toHaveCount(0);

    const session = (await context.cookies()).find((cookie) => cookie.name === 'ol_share');
    expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax' });

    await page.reload();
    await expect(accessCodeInput).toHaveCount(0);
  });
});
