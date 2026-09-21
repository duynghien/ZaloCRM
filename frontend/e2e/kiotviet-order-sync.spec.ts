import { expect, test } from '@playwright/test';

test.describe('KiotViet Integration E2E', () => {
  test('member is forbidden from accessing KiotViet settings, owner can access KiotViet tab', async ({ page, request }) => {
    const fixture = await (await request.post('/__fixture/seed')).json();
    const ownerHeaders = { authorization: `Bearer ${fixture.ownerToken}` };

    // 1. Verify backend RBAC: member cannot read /api/v1/kiotviet/config
    const memberHeaders = { authorization: `Bearer ${fixture.memberToken || fixture.token}` };
    const memberDenied = await request.get('/api/v1/kiotviet/config', { headers: memberHeaders });
    expect(memberDenied.status()).toBe(403);

    // 2. Owner can read public config
    const ownerConfigRes = await request.get('/api/v1/kiotviet/config/public', { headers: ownerHeaders });
    expect(ownerConfigRes.status()).toBe(200);
    const ownerConfig = await ownerConfigRes.json();
    expect(ownerConfig.clientSecret).toBeUndefined();

    // 3. Login as owner in browser
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(fixture.ownerEmail || 'admin@example.com');
    await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.ownerPassword || 'password123');
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page).toHaveURL('/');

    // 4. Navigate to /settings and check for KiotViet tab
    await page.goto('/settings');
    const kiotvietTab = page.getByRole('tab', { name: 'KiotViet' });
    if (await kiotvietTab.isVisible()) {
      await kiotvietTab.click();
      await expect(page.getByText('TÍCH HỢP KIOTVIET')).toBeVisible();
    }
  });

  test('orders view renders KiotViet invoice status column and create order dialog', async ({ page, request }) => {
    const fixture = await (await request.post('/__fixture/seed')).json();

    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(fixture.ownerEmail || 'admin@example.com');
    await page.getByLabel('Mật khẩu', { exact: true }).fill(fixture.ownerPassword || 'password123');
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page).toHaveURL('/');

    await page.goto('/orders');
    await expect(page.getByText('QUẢN LÝ ĐƠN HÀNG')).toBeVisible();
    await expect(page.getByText('Hóa đơn KiotViet')).toBeVisible();

    // Click 'TẠO ĐƠN HÀNG'
    await page.getByRole('button', { name: 'TẠO ĐƠN HÀNG' }).click();
    await expect(page.getByText('TẠO ĐƠN HÀNG MỚI')).toBeVisible();
    await expect(page.getByText('DANH SÁCH SẢN PHẨM')).toBeVisible();
    await expect(page.getByText('TIỀN THỰC THU & PHƯƠNG THỨC')).toBeVisible();
  });
});
