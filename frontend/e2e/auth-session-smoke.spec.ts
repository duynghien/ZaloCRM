import { expect, test } from '@playwright/test';


test('login route renders without storing a bearer token', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading')).toBeVisible();
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage)
    .some((key) => /token|auth/i.test(key)))).toBe(false);
});
