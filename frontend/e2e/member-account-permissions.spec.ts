import { expect, test } from '@playwright/test';

test('member read/chat/admin grants enforce browser send and QR actions', async ({ page, request }) => {
  const fixture = await (await request.post('/__fixture/seed', { data: { permission: 'read' } })).json();
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL('/');
  await page.goto('/chat');
  await page.getByText('Browser Contact', { exact: true }).click();
  await expect(page.getByText('Original browser message', { exact: true }).last()).toBeVisible();
  const send = page.waitForResponse(response => response.url().endsWith(`/conversations/${fixture.conversationId}/messages`) && response.request().method() === 'POST');
  await page.getByPlaceholder('Nhập tin nhắn...').fill('Read cannot send');
  await page.getByPlaceholder('Nhập tin nhắn...').press('Enter');
  expect((await send).status()).toBe(403);
  for (const permission of ['chat', 'admin']) {
    expect((await request.put(`/api/v1/zalo-accounts/${fixture.accountId}/access/${fixture.grantId}`, {
      headers: { authorization: `Bearer ${fixture.ownerToken}` }, data: { permission },
    })).ok()).toBe(true);
    if (permission === 'chat') {
      const allowed = page.waitForResponse(response => response.url().endsWith(`/conversations/${fixture.conversationId}/messages`) && response.request().method() === 'POST');
      await page.getByPlaceholder('Nhập tin nhắn...').fill('Chat reaches account availability check');
      await page.getByPlaceholder('Nhập tin nhắn...').press('Enter');
      const result = await allowed;
      expect(result.status()).toBe(400);
      expect(await result.json()).toEqual({ error: 'Zalo account not connected' });
    }
    await page.goto('/zalo-accounts');
    await page.getByTitle('Đăng nhập QR').click();
    if (permission === 'chat') {
      await expect(page.getByText('Forbidden or subscription cancelled', { exact: true })).toBeVisible();
      await expect(page.getByAltText('QR Code')).toHaveCount(0);
      await page.getByRole('button', { name: 'Đóng', exact: true }).click();
    } else await expect(page.getByAltText('QR Code')).toBeVisible();
  }
});
