import { expect, test } from '@playwright/test';

test('QR login waits for admin subscription, restores on reconnect, and cancel prevents replay', async ({ page, request }) => {
  const fixture = await (await request.post('/__fixture/seed')).json();
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL('/');
  await page.goto('/zalo-accounts');
  await page.getByTitle('Đăng nhập QR').click();
  await expect(page.getByAltText('QR Code')).toBeVisible();
  const state = () => request.get('/__fixture/state').then(res => res.json());
  expect((await state()).loginChecks.slice(fixture.loginOffset)).toEqual([true]);
  const firstConnections = (await state()).connections;
  await request.post('/__fixture/control', { data: { action: 'disconnect' } });
  await expect.poll(async () => (await state()).connections).toBeGreaterThan(firstConnections);
  await expect.poll(async () => (await state()).subscriptions).toContain(`account:${fixture.accountId}`);
  await request.post('/__fixture/control', { data: { action: 'qr' } });
  await expect(page.getByText('Restored QR intent', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Đóng', exact: true }).click();
  await expect.poll(async () => (await state()).subscriptions).not.toContain(`account:${fixture.accountId}`);
  const cancelledConnections = (await state()).connections;
  await request.post('/__fixture/control', { data: { action: 'disconnect' } });
  await expect.poll(async () => (await state()).connections).toBeGreaterThan(cancelledConnections);
  expect((await state()).subscriptions).not.toContain(`account:${fixture.accountId}`);
  await request.post('/__fixture/control', { data: { action: 'qr' } });
  await expect(page.getByText('Quét QR để đăng nhập Zalo', { exact: true })).not.toBeVisible();
  expect((await state()).loginChecks.slice(fixture.loginOffset)).toEqual([true]);
});

test('QR reconnect rejects an admin intent downgraded to read through REST', async ({ page, request }) => {
  const fixture = await (await request.post('/__fixture/seed')).json();
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL('/');
  await page.goto('/zalo-accounts');
  await page.getByTitle('Đăng nhập QR').click();
  await expect(page.getByAltText('QR Code')).toBeVisible();
  const state = () => request.get('/__fixture/state').then(res => res.json());
  const downgraded = await request.put(`/api/v1/zalo-accounts/${fixture.accountId}/access/${fixture.grantId}`, {
    headers: { authorization: `Bearer ${fixture.ownerToken}` }, data: { permission: 'read' },
  });
  expect(downgraded.ok()).toBe(true);
  expect((await state()).subscriptions).not.toContain(`account:${fixture.accountId}`);
  const previousConnections = (await state()).connections;
  await request.post('/__fixture/control', { data: { action: 'disconnect' } });
  await expect.poll(async () => (await state()).connections).toBeGreaterThan(previousConnections);
  await expect(page.getByText('Forbidden or subscription cancelled', { exact: true })).toBeVisible();
  await expect(page.getByAltText('QR Code')).toHaveCount(0);
  await request.post('/__fixture/control', { data: { action: 'qr' } });
  await expect(page.getByText('Restored QR intent', { exact: true })).toHaveCount(0);
  expect((await state()).subscriptions).not.toContain(`account:${fixture.accountId}`);
  expect((await state()).loginChecks.slice(fixture.loginOffset)).toEqual([true]);
});
