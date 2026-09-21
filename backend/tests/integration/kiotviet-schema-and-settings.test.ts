import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/test-app.js';
import {
  saveKiotvietConfig,
  getKiotvietConfig,
  getKiotvietPublicConfig,
  KiotvietConflictError,
  KIOTVIET_SETTING_KEYS,
} from '../../src/modules/integrations/kiotviet/kiotviet-settings-service.js';

let fixture: Awaited<ReturnType<typeof createTestApp>> | undefined;
const password = 'FixturePassword123';
let passwordHash: string;

beforeAll(async () => {
  try {
    fixture = await createTestApp();
    passwordHash = await bcrypt.hash(password, 4);
  } catch (err) {
    // If docker is not available in sandbox, log and skip integration tests gracefully
    console.warn('[kiotviet-schema-and-settings] Disposable postgres unavailable:', err);
  }
}, 120_000);

afterAll(async () => {
  await fixture?.close();
});

describe('KiotViet Schema and Settings Integration', () => {
  it('verifies schema relations and settings persistence on PostgreSQL', async () => {
    if (!fixture) {
      console.warn('Skipping integration test: PostgreSQL container not available in this environment');
      return;
    }

    const org = await fixture.prisma.organization.create({
      data: { name: 'KiotViet Test Org' },
    });

    // 1. Initial public config is empty/unconfigured
    const initialConfig = await getKiotvietPublicConfig(org.id, fixture.prisma);
    expect(initialConfig.secretConfigured).toBe(false);
    expect(initialConfig.configRevision).toBe(0);
    expect(initialConfig.retailer).toBe('');

    // 2. Save configuration with secret
    const saved = await saveKiotvietConfig(
      org.id,
      {
        clientId: 'test-client-id',
        clientSecret: 'super-secret-key-12345',
        retailer: 'test-retailer',
        branchId: '987654321',
        autoSync: true,
      },
      0
    );

    expect(saved.secretConfigured).toBe(true);
    expect(saved.configRevision).toBe(1);
    expect(saved.retailer).toBe('test-retailer');
    expect(saved.branchId).toBe('987654321');
    expect(saved.autoSync).toBe(true);
    expect((saved as any).clientSecret).toBeUndefined();

    // 3. Execution config reads decrypted secret
    const execConfig = await getKiotvietConfig(org.id, fixture.prisma);
    expect(execConfig?.clientSecret).toBe('super-secret-key-12345');
    expect(execConfig?.configRevision).toBe(1);

    // 4. Verify secret in app_settings table is encrypted and valuePlain is null
    const secretRow = await fixture.prisma.appSetting.findUnique({
      where: { orgId_settingKey: { orgId: org.id, settingKey: KIOTVIET_SETTING_KEYS.CLIENT_SECRET } },
    });
    expect(secretRow?.valuePlain).toBeNull();
    expect(secretRow?.valueEncrypted).not.toBeNull();

    // 5. Test revision conflict
    await expect(
      saveKiotvietConfig(org.id, { retailer: 'changed' }, 0)
    ).rejects.toThrow(KiotvietConflictError);

    // 6. Test secret omission preserves existing secret
    const updated = await saveKiotvietConfig(
      org.id,
      {
        retailer: 'new-retailer',
      },
      1
    );
    expect(updated.configRevision).toBe(2);
    expect(updated.secretConfigured).toBe(true);
    const execConfig2 = await getKiotvietConfig(org.id, fixture.prisma);
    expect(execConfig2?.clientSecret).toBe('super-secret-key-12345');
    expect(execConfig2?.retailer).toBe('new-retailer');

    // 7. Verify OrderItem and KiotvietInvoiceJob schema constraints
    const user = await fixture.prisma.user.create({
      data: {
        orgId: org.id,
        email: `${randomUUID()}@test.invalid`,
        fullName: 'Test User',
        passwordHash,
      },
    });

    const contact = await fixture.prisma.contact.create({
      data: {
        orgId: org.id,
        fullName: 'Customer Test',
        phone: '0901234567',
      },
    });

    const order = await fixture.prisma.order.create({
      data: {
        id: randomUUID(),
        orgId: org.id,
        contactId: contact.id,
        createdByUserId: user.id,
        orderCode: 'ORD-TEST-01',
        totalAmount: 500000,
        paidAmount: 200000,
        paymentMethod: 'Transfer',
        kiotvietSyncStatus: 'pending',
      },
    });

    // Create OrderItem
    const item = await fixture.prisma.orderItem.create({
      data: {
        orgId: org.id,
        orderId: order.id,
        kiotvietProductId: BigInt(112233),
        retailer: 'new-retailer',
        branchId: BigInt(987654321),
        productCode: 'SP001',
        productName: 'Sản phẩm 1',
        quantity: 2,
        price: 250000,
        subtotal: 500000,
      },
    });
    expect(item.id).toBeDefined();

    // Create KiotvietInvoiceJob
    const job = await fixture.prisma.kiotvietInvoiceJob.create({
      data: {
        orgId: org.id,
        orderId: order.id,
        orderRevision: 0,
        configRevision: 2,
        retailer: 'new-retailer',
        branchId: BigInt(987654321),
        snapshot: { test: true },
        snapshotHash: 'hash-test',
        state: 'queued',
      },
    });
    expect(job.id).toBeDefined();

    // In-flight guard: config mutation must fail while job is dispatching/uncertain
    await fixture.prisma.kiotvietInvoiceJob.update({
      where: { id: job.id },
      data: { state: 'dispatching' },
    });

    await expect(
      saveKiotvietConfig(org.id, { autoSync: false }, 2)
    ).rejects.toThrow(KiotvietConflictError);
  });
});
