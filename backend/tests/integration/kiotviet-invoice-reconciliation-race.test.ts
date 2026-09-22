process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_long_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { reconcileInvoice } from '../../src/modules/integrations/kiotviet/kiotviet-invoice-reconciliation.js';
import { enqueueInvoiceTx } from '../../src/modules/integrations/kiotviet/kiotviet-invoice-service.js';
import * as kiotvietClient from '../../src/modules/integrations/kiotviet/kiotviet-client.js';
import * as kiotvietSettings from '../../src/modules/integrations/kiotviet/kiotviet-settings-service.js';
import { prisma } from '../../src/shared/database/prisma-client.js';
import { KiotvietConflictError } from '../../src/modules/integrations/kiotviet/kiotviet-settings-service.js';

vi.mock('../../src/shared/database/prisma-client.js', () => {
  const mockPrisma: any = {
    order: {
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    kiotvietInvoiceJob: {
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    activityLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(mockPrisma)),
  };
  return { prisma: mockPrisma };
});

vi.mock('../../src/modules/integrations/kiotviet/kiotviet-client.js', () => ({
  getKiotvietInvoice: vi.fn(),
}));

vi.mock('../../src/modules/integrations/kiotviet/kiotviet-settings-service.js', async (importOriginal) => {
  const original = await importOriginal<typeof kiotvietSettings>();
  return {
    ...original,
    getKiotvietConfig: vi.fn(),
  };
});

describe('KiotViet Invoice Reconciliation CAS Fencing & Race Tests', () => {
  const orgId = 'org-1';
  const orderId = 'order-1';
  const actorId = 'admin-user';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects confirm-not-created with 409 conflict if CAS update count is 0 (job actively dispatching or lease active)', async () => {
    vi.mocked(kiotvietSettings.getKiotvietConfig).mockResolvedValueOnce({
      retailer: 'test-shop',
      branchId: '10001',
    } as any);

    vi.mocked(prisma.order.findFirst).mockResolvedValueOnce({
      id: orderId,
      orgId,
      kiotvietJob: {
        id: 'job-1',
        state: 'uncertain',
        remoteInvoiceId: null,
        leaseVersion: 1,
        leaseOwner: 'worker-active',
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    } as any);

    // CAS update returns count: 0 because lease is still active
    vi.mocked(prisma.kiotvietInvoiceJob.updateMany).mockResolvedValueOnce({ count: 0 });

    await expect(
      reconcileInvoice({
        orgId,
        orderId,
        action: 'confirm-not-created',
        reason: 'Attempt reconciliation while worker active',
        actorId,
      })
    ).rejects.toThrow(KiotvietConflictError);
  });

  it('blocks re-enqueueing via enqueueInvoiceTx if order already has remote invoice created', async () => {
    const mockTx = {
      order: {
        findFirst: vi.fn().mockResolvedValueOnce({
          id: orderId,
          orgId,
          orderCode: 'DH001',
          status: 'confirmed',
          revision: 1,
          kiotvietSyncStatus: 'failed',
          kiotvietInvoiceId: BigInt(8888),
          kiotvietInvoiceCode: 'HD008888',
          items: [{ id: 'item-1', kiotvietProductId: BigInt(1), quantity: 1, price: 10000 }],
          kiotvietJob: {
            id: 'job-1',
            remoteInvoiceId: BigInt(8888),
            remoteInvoiceCode: 'HD008888',
          },
        }),
      },
    } as any;

    await expect(
      enqueueInvoiceTx(mockTx, {
        orderId,
        orgId,
        mode: 'manual',
      })
    ).rejects.toThrow(/Đơn hàng đã có hóa đơn KiotViet tương ứng/);
  });
});
