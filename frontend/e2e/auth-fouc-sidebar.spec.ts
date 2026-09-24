import { expect, test } from '@playwright/test';

test.describe('Auth FOUC & Shell Leak Defense', () => {
  test('unauthenticated direct access to /chat never renders sidebar during 800ms pending refresh', async ({ page }) => {
    let notifyRequestArrived!: () => void;
    const requestArrived = new Promise<void>((r) => {
      notifyRequestArrived = r;
    });

    let releaseRefresh!: () => void;
    const refreshHeld = new Promise<void>((r) => {
      releaseRefresh = r;
    });

    await page.route('**/api/v1/auth/refresh', async (route) => {
      notifyRequestArrived();
      await refreshHeld;
      await route.fulfill({ status: 401, json: { error: 'Missing refresh session' } });
    });

    const navigation = page.goto('/chat', { waitUntil: 'commit' });

    // Wait until Vue App actually loads JS and sends refresh request
    await requestArrived;

    // Assert strictly in intermediate frame: zero drawer, zero topbar
    await expect(page.locator('.v-navigation-drawer')).toHaveCount(0);
    await expect(page.locator('.app-top-bar')).toHaveCount(0);

    // Release refresh
    releaseRefresh();
    await navigation;

    // Assert final destination is Login with redirect query
    await expect(page).toHaveURL(/\/login\?redirect=%2Fchat/);
    await expect(page.locator('.v-navigation-drawer')).toHaveCount(0);
    await expect(page.locator('.app-top-bar')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /đăng nhập/i })).toBeVisible();
  });

  test('unauthenticated visit to unknown route redirects to login without leaking shell', async ({ page }) => {
    await page.route('**/api/v1/auth/refresh', async (route) => {
      await route.fulfill({ status: 401, json: { error: 'Missing refresh session' } });
    });

    await page.goto('/random-nonexistent-path', { waitUntil: 'commit' });
    await expect(page.locator('.v-navigation-drawer')).toHaveCount(0);
    await expect(page.locator('.app-top-bar')).toHaveCount(0);
    await expect(page).toHaveURL(/\/login\?redirect=%2Frandom-nonexistent-path/);
  });

  test('network outage (502) shows NetworkErrorBanner without leaking shell', async ({ page }) => {
    await page.route('**/api/v1/auth/refresh', async (route) => {
      await route.fulfill({ status: 502, body: 'Bad Gateway' });
    });

    await page.goto('/chat', { waitUntil: 'commit' });
    await expect(page.locator('.v-navigation-drawer')).toHaveCount(0);
    await expect(page.locator('.app-top-bar')).toHaveCount(0);
    await expect(page.getByText('KHÔNG THỂ KẾT NỐI MÁY CHỦ')).toBeVisible();
    await expect(page.getByRole('button', { name: /thử kết nối lại/i })).toBeVisible();
  });

  test('successful login redirects back to requested redirect query URL', async ({ page, request }) => {
    const fixture = await (await request.post('/__fixture/seed')).json();
    await page.goto('/login?redirect=%2Fchat');
    await page.getByLabel('Email', { exact: true }).fill(fixture.email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.password);
    await page.getByRole('button', { name: /đăng nhập/i }).click();
    await expect(page).toHaveURL('/chat');
    await expect(page.locator('.v-navigation-drawer')).toHaveCount(1);
  });

  test('authenticated direct access to /login redirects to dashboard without form flash', async ({ page, request }) => {
    const fixture = await (await request.post('/__fixture/seed')).json();
    // First establish authenticated session
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(fixture.email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.password);
    await page.getByRole('button', { name: /đăng nhập/i }).click();
    await expect(page).toHaveURL('/');

    // Directly navigate back to /login while authenticated
    await page.goto('/login');
    await expect(page).toHaveURL('/');
    await expect(page.locator('.brand-logo-login')).toHaveCount(0);
  });
});
