process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_long_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getKiotvietConfig,
  getKiotvietPublicConfig,
  saveKiotvietConfig,
  KiotvietConflictError,
  KIOTVIET_SETTING_KEYS,
} from '../../src/modules/integrations/kiotviet/kiotviet-settings-service.js';
import { prisma } from '../../src/shared/database/prisma-client.js';
import { encodeSecureSetting } from '../../src/shared/settings/secure-setting-codec.js';
import { RequestValidationError } from '../../src/shared/http/request-schemas.js';

vi.mock('../../src/shared/database/prisma-client.js', () => {
  const mockPrisma: any = {
    appSetting: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    kiotvietSyncState: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    kiotvietInvoiceJob: {
      count: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(mockPrisma)),
  };
  return { prisma: mockPrisma };
});

describe('KiotvietSettingsService', () => {
  const orgId = 'org-test-1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Validation & Sanitization', () => {
    it('rejects masked secret placeholder like ****** or ••••••', async () => {
      await expect(
        saveKiotvietConfig(orgId, { clientSecret: '******' })
      ).rejects.toThrow(RequestValidationError);

      await expect(
        saveKiotvietConfig(orgId, { clientSecret: '••••••' })
      ).rejects.toThrow(RequestValidationError);
    });

    it('rejects invalid fields', async () => {
      await expect(
        saveKiotvietConfig(orgId, { clientId: 'a'.repeat(300) })
      ).rejects.toThrow(RequestValidationError);

      await expect(
        saveKiotvietConfig(orgId, { autoSync: 'yes' as any })
      ).rejects.toThrow(RequestValidationError);
    });
  });

  describe('Fencing & Concurrency Guards', () => {
    it('throws 409 invoice_in_flight if an invoice job is dispatching or uncertain', async () => {
      (prisma.kiotvietInvoiceJob.count as any).mockResolvedValueOnce(1);

      await expect(
        saveKiotvietConfig(orgId, { retailer: 'new-shop' })
      ).rejects.toThrow(KiotvietConflictError);

      try {
        (prisma.kiotvietInvoiceJob.count as any).mockResolvedValueOnce(1);
        await saveKiotvietConfig(orgId, { retailer: 'new-shop' });
      } catch (err: any) {
        expect(err.statusCode).toBe(409);
        expect(err.code).toBe('invoice_in_flight');
      }
    });

    it('throws 409 config_changed when expectedRevision does not match currentRevision', async () => {
      (prisma.kiotvietInvoiceJob.count as any).mockResolvedValueOnce(0);
      (prisma.kiotvietSyncState.findUnique as any).mockResolvedValueOnce({
        orgId,
        configRevision: 5,
      });

      await expect(
        saveKiotvietConfig(orgId, { retailer: 'my-shop' }, 3)
      ).rejects.toThrow(KiotvietConflictError);

      try {
        (prisma.kiotvietInvoiceJob.count as any).mockResolvedValueOnce(0);
        (prisma.kiotvietSyncState.findUnique as any).mockResolvedValueOnce({
          orgId,
          configRevision: 5,
        });
        await saveKiotvietConfig(orgId, { retailer: 'my-shop' }, 3);
      } catch (err: any) {
        expect(err.statusCode).toBe(409);
        expect(err.code).toBe('config_changed');
      }
    });
  });

  describe('Secret Handling & Catalog Reset', () => {
    it('encrypts secret, preserves omission, and resets catalog on retailer change', async () => {
      (prisma.kiotvietInvoiceJob.count as any).mockResolvedValue(0);
      (prisma.kiotvietSyncState.findUnique as any).mockResolvedValue({
        orgId,
        configRevision: 1,
        retailer: 'old-retailer',
        branchId: BigInt(123),
        catalogReady: true,
        catalogCursor: new Date(),
      });
      (prisma.appSetting.findMany as any).mockResolvedValue([
        {
          orgId,
          settingKey: KIOTVIET_SETTING_KEYS.CLIENT_SECRET,
          valuePlain: null,
          valueEncrypted: encodeSecureSetting('existing-secret').valueEncrypted,
        },
        {
          orgId,
          settingKey: KIOTVIET_SETTING_KEYS.RETAILER,
          valuePlain: 'old-retailer',
        },
      ]);

      // Save new retailer, omitting secret
      await saveKiotvietConfig(
        orgId,
        {
          retailer: 'new-retailer',
          branchId: '456',
        },
        1
      );

      // Verify jobs under old revision were marked failed
      expect(prisma.kiotvietInvoiceJob.updateMany).toHaveBeenCalledWith({
        where: {
          orgId,
          state: { in: ['queued', 'preparing'] },
        },
        data: expect.objectContaining({
          state: 'failed',
          errorCode: 'config_changed',
        }),
      });

      // Verify sync state updated with next revision (2) and catalog reset
      expect(prisma.kiotvietSyncState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId },
          update: expect.objectContaining({
            configRevision: 2,
            retailer: 'new-retailer',
            branchId: BigInt(456),
            catalogReady: false,
            catalogCursor: null,
          }),
        })
      );
    });

    it('clears secret when clearSecret is true', async () => {
      (prisma.kiotvietInvoiceJob.count as any).mockResolvedValue(0);
      (prisma.kiotvietSyncState.findUnique as any).mockResolvedValue({
        orgId,
        configRevision: 1,
      });
      (prisma.appSetting.findMany as any).mockResolvedValue([]);

      await saveKiotvietConfig(orgId, { clearSecret: true }, 1);

      expect(prisma.appSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_settingKey: { orgId, settingKey: KIOTVIET_SETTING_KEYS.CLIENT_SECRET } },
          create: expect.objectContaining({
            valuePlain: null,
            valueEncrypted: null,
          }),
          update: expect.objectContaining({
            valuePlain: null,
            valueEncrypted: null,
          }),
        })
      );
    });
  });

  describe('getKiotvietConfig & getKiotvietPublicConfig', () => {
    it('reads execution config with decrypted secret directly from DB', async () => {
      const secret = 'my-super-secret';
      const encoded = encodeSecureSetting(secret);

      (prisma.appSetting.findMany as any).mockResolvedValue([
        { orgId, settingKey: KIOTVIET_SETTING_KEYS.CLIENT_ID, valuePlain: 'client-1' },
        { orgId, settingKey: KIOTVIET_SETTING_KEYS.CLIENT_SECRET, valuePlain: null, valueEncrypted: encoded.valueEncrypted },
        { orgId, settingKey: KIOTVIET_SETTING_KEYS.RETAILER, valuePlain: 'shop-1' },
        { orgId, settingKey: KIOTVIET_SETTING_KEYS.BRANCH_ID, valuePlain: '789' },
        { orgId, settingKey: KIOTVIET_SETTING_KEYS.AUTO_SYNC, valuePlain: 'true' },
      ]);
      (prisma.kiotvietSyncState.findUnique as any).mockResolvedValue({
        orgId,
        configRevision: 3,
        retailer: 'shop-1',
        branchId: BigInt(789),
      });

      const config = await getKiotvietConfig(orgId);
      expect(config).toEqual({
        clientId: 'client-1',
        clientSecret: secret,
        retailer: 'shop-1',
        branchId: '789',
        autoSync: true,
        soldById: null,
        paymentAccountId: null,
        configRevision: 3,
      });
    });

    it('returns public config without exposing secret', async () => {
      const secret = 'my-super-secret';
      const encoded = encodeSecureSetting(secret);

      (prisma.appSetting.findMany as any).mockResolvedValue([
        { orgId, settingKey: KIOTVIET_SETTING_KEYS.CLIENT_ID, valuePlain: 'client-1' },
        { orgId, settingKey: KIOTVIET_SETTING_KEYS.CLIENT_SECRET, valuePlain: null, valueEncrypted: encoded.valueEncrypted },
        { orgId, settingKey: KIOTVIET_SETTING_KEYS.RETAILER, valuePlain: 'shop-1' },
        { orgId, settingKey: KIOTVIET_SETTING_KEYS.BRANCH_ID, valuePlain: '789' },
        { orgId, settingKey: KIOTVIET_SETTING_KEYS.AUTO_SYNC, valuePlain: 'false' },
      ]);
      (prisma.kiotvietSyncState.findUnique as any).mockResolvedValue({
        orgId,
        configRevision: 3,
        retailer: 'shop-1',
        branchId: BigInt(789),
        catalogReady: true,
        lastSuccessfulAt: new Date('2026-09-21T10:00:00.000Z'),
      });

      const pub = await getKiotvietPublicConfig(orgId);
      expect(pub).toEqual({
        clientId: 'client-1',
        retailer: 'shop-1',
        branchId: '789',
        autoSync: false,
        soldById: null,
        paymentAccountId: null,
        secretConfigured: true,
        configRevision: 3,
        catalogReady: true,
        lastSuccessfulSyncAt: '2026-09-21T10:00:00.000Z',
      });
      expect((pub as any).clientSecret).toBeUndefined();
    });
  });
});
