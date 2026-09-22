process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_long_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  tickCatalogWorker,
  startCatalogWorker,
  stopCatalogWorker,
} from '../../src/modules/integrations/kiotviet/kiotviet-catalog-worker.js';
import * as kiotvietClient from '../../src/modules/integrations/kiotviet/kiotviet-client.js';
import * as kiotvietSettings from '../../src/modules/integrations/kiotviet/kiotviet-settings-service.js';
import { prisma } from '../../src/shared/database/prisma-client.js';
import { zaloPool } from '../../src/modules/zalo/zalo-pool.js';
import * as socketDelivery from '../../src/shared/realtime/socket-event-delivery.js';

vi.mock('../../src/shared/database/prisma-client.js', () => {
  const mockPrisma: any = {
    kiotvietSyncState: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    kiotvietProduct: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(mockPrisma)),
  };
  return { prisma: mockPrisma };
});

vi.mock('../../src/modules/integrations/kiotviet/kiotviet-client.js', () => ({
  getKiotvietProductsPage: vi.fn(),
}));

vi.mock('../../src/modules/integrations/kiotviet/kiotviet-settings-service.js', async (importOriginal) => {
  const original = await importOriginal<typeof kiotvietSettings>();
  return {
    ...original,
    getKiotvietConfig: vi.fn(),
  };
});

vi.mock('../../src/modules/zalo/zalo-pool.js', () => ({
  zaloPool: {
    getIO: vi.fn(),
  },
}));

vi.mock('../../src/shared/realtime/socket-event-delivery.js', () => ({
  emitManagerEvent: vi.fn(),
}));

describe('KiotViet Catalog Worker Fencing & Traversal Limit Tests', () => {
  const orgId = 'org-1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails fast on catalog exceeding 50,000 products, aborts sync without deactivating products and emits alert', async () => {
    const mockIO = {} as any;
    vi.mocked(zaloPool.getIO).mockReturnValue(mockIO);

    // Initial state query in tickCatalogWorker
    vi.mocked(prisma.kiotvietSyncState.findMany).mockResolvedValueOnce([{ orgId }] as any);

    let capturedWorkerId: string | null = null;
    vi.mocked(prisma.kiotvietSyncState.updateMany).mockImplementation((args: any) => {
      if (args.data?.leaseOwner) {
        capturedWorkerId = args.data.leaseOwner;
      }
      return Promise.resolve({ count: 1 }) as any;
    });

    // Claimed record
    vi.mocked(prisma.kiotvietSyncState.findUnique).mockImplementation((args: any) => {
      if (args.select) {
        return Promise.resolve({
          leaseOwner: capturedWorkerId,
          leaseVersion: 1,
          configRevision: 1,
        }) as any;
      }
      return Promise.resolve({
        orgId,
        runId: 'run-123',
        runMode: 'full',
        configRevision: 1,
        branchId: BigInt(10001),
        retailer: 'test-shop',
        leaseOwner: capturedWorkerId,
        leaseVersion: 1,
      }) as any;
    });

    vi.mocked(kiotvietSettings.getKiotvietConfig).mockResolvedValueOnce({
      retailer: 'test-shop',
      branchId: '10001',
      configRevision: 1,
    } as any);

    // Mock 500 pages returned, each 100 items, with total = 60,000 products
    const sampleProducts = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      code: `SP${i + 1}`,
      name: `Product ${i + 1}`,
      basePrice: 50000,
    }));

    vi.mocked(kiotvietClient.getKiotvietProductsPage).mockResolvedValue({
      total: 60000,
      data: sampleProducts as any,
    });

    startCatalogWorker();
    await tickCatalogWorker();
    await stopCatalogWorker();

    // Verify full sweep updateMany on products (which deactivates unvisited) was NEVER called
    expect(prisma.kiotvietProduct.updateMany).not.toHaveBeenCalled();

    // Verify alert socket event was emitted
    expect(socketDelivery.emitManagerEvent).toHaveBeenCalledWith(
      mockIO,
      orgId,
      'kiotviet:catalog:alert',
      expect.objectContaining({
        orgId,
        runId: 'run-123',
        totalProducts: 60000,
        limit: 50000,
      })
    );
  });
});
