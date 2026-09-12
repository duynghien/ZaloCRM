import { expect, test } from '@playwright/test';

for (const recovery of ['overflow', 'disconnect']) {
  test(`chat ${recovery} reloads DB undo/messages and clears revoked active data`, async ({ page, request }) => {
    const fixture = await (await request.post('/__fixture/seed')).json();
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(fixture.email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.password);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page).toHaveURL('/');
    await page.goto('/chat');
    await page.getByText('Browser Contact', { exact: true }).click();
    await expect(page.getByText('Original browser message', { exact: true }).last()).toBeVisible();
    await request.post('/__fixture/control', { data: { action: recovery === 'overflow' ? 'overflow' : 'change', ...fixture } });
    if (recovery === 'disconnect') await request.post('/__fixture/control', { data: { action: recovery } });
    await expect(page.getByText('Recovered browser message', { exact: true }).last()).toBeVisible();
    await expect(page.getByText('Original browser message (đã thu hồi)', { exact: false })).toBeVisible();
    await expect(page.locator('.message-bubble')).toHaveCount(2);
    // Pause an actual REST request before server authorization; no response is mocked.
    let release!: () => void;
    let reached!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const pending = new Promise<void>(resolve => { reached = resolve; });
    await page.route(`**/conversations/${fixture.conversationId}/messages?*`, async route => {
      reached(); await held; await route.continue();
    }, { times: 1 });
    await request.post('/__fixture/control', { data: { action: 'resync' } });
    await pending;
    let requestsAfterRevoke = 0;
    page.on('request', req => { if (req.url().includes('/api/v1/conversations')) requestsAfterRevoke++; });
    const revoked = await request.delete(`/api/v1/zalo-accounts/${fixture.accountId}/access/${fixture.grantId}`, { headers: { authorization: `Bearer ${fixture.ownerToken}` } });
    expect(revoked.status()).toBe(204);
    release();
    await expect(page.getByText('Recovered browser message', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Browser Contact', { exact: true })).toHaveCount(0);
    // Observe a bounded quiet window to expose an accidental refetch loop.
    await page.waitForTimeout(750);
    expect(requestsAfterRevoke).toBeLessThanOrEqual(3);
    const connections = (await (await request.get('/__fixture/state')).json()).connections;
    await request.post('/__fixture/control', { data: { action: 'disconnect' } });
    await expect.poll(async () => (await (await request.get('/__fixture/state')).json()).connections).toBeGreaterThan(connections);
    await expect(page.getByText('Recovered browser message', { exact: true })).toHaveCount(0);
  });
}


test('undo for the same provider message ID on another account preserves the active message', async ({ page, request }) => {
  const fixture = await (await request.post('/__fixture/seed')).json();
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL('/');
  await page.goto('/chat');
  await page.getByText('Browser Contact', { exact: true }).click();
  await expect(page.getByText('Original browser message', { exact: true }).last()).toBeVisible();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/conversations/${fixture.conversationId}/messages?*`, async route => {
    await held; await route.continue();
  });
  try {
    await request.post('/__fixture/control', { data: { action: 'other-account-undo', ...fixture } });
    await expect(page.getByText('Undo transport barrier', { exact: true }).last()).toBeVisible();
    await expect(page.getByText('Original browser message', { exact: true }).last()).toBeVisible();
    await expect(page.getByText('Original browser message (đã thu hồi)', { exact: false })).toHaveCount(0);
  } finally { release(); }
});
