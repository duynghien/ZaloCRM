import { expect, test } from '@playwright/test';

test.skip(!process.env.CI && !process.env.RUN_E2E, 'Set RUN_E2E=1 after installing Playwright browsers. CI always runs this smoke.');

test('login route renders without storing a bearer token', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading')).toBeVisible();
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage)
    .some((key) => /token|auth/i.test(key)))).toBe(false);
});
