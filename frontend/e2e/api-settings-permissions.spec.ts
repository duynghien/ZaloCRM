import { expect, test } from '@playwright/test';

test('member settings page receives forbidden responses and never reveals or rotates API keys', async ({ page, request }) => {
  const fixture = await (await request.post('/__fixture/seed')).json();
  const ownerHeaders = { authorization: `Bearer ${fixture.ownerToken}` };
  const generated = await request.post('/api/v1/settings/api-key/generate', { headers: ownerHeaders });
  expect(generated.ok()).toBe(true);
  const before = await (await request.get('/api/v1/settings/api-key', { headers: ownerHeaders })).json();
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL('/');
  const denied = page.waitForResponse(response => response.url().endsWith('/settings/api-key') && response.status() === 403);
  await page.goto('/api-settings');
  expect((await denied).status()).toBe(403);
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
  const rotation = page.waitForResponse(response => response.url().endsWith('/settings/api-key/generate'));
  await page.getByRole('button', { name: 'Tạo key mới', exact: true }).click();
  expect((await rotation).status()).toBe(403);
  expect(await (await request.get('/api/v1/settings/api-key', { headers: ownerHeaders })).json()).toEqual(before);
});
