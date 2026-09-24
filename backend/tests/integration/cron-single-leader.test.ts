import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { prisma } from '../../src/shared/database/prisma-client.js';
import { withCronLock, CRON_LOCKS } from '../../src/shared/utils/lock-registry.js';
import {
  checkAndReserveRateLimit,
  KiotvietRateLimitError,
} from '../../src/modules/integrations/kiotviet/kiotviet-rate-limit-service.js';
import { publicApiRoutes } from '../../src/modules/api/public-api-routes.js';
import { webhookSettingsRoutes } from '../../src/modules/api/webhook-settings-routes.js';

describe('Distributed Cron, API Keys & Durable Limits (Phase 6: F-09, F-10, F-11, F-12, F-14)', () => {
  describe('F-09: Transactional Advisory Locks for Distributed Cron', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('executes task when lock is acquired and skips when lock is held by another transaction', async () => {
      let isFirstTransactionHolding = true;

      // Mock transaction client & queryRaw
      const mockTxFirst: any = {
        $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]),
      };
      const mockTxSecond: any = {
        $queryRaw: vi.fn().mockResolvedValue([{ locked: false }]),
      };

      vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => {
        if (isFirstTransactionHolding) {
          return callback(mockTxFirst);
        } else {
          return callback(mockTxSecond);
        }
      });

      // 1. Leader acquires lock and executes
      let leaderExecuted = false;
      const leaderRes = await withCronLock(CRON_LOCKS.APPOINTMENT_REMINDER, async () => {
        leaderExecuted = true;
        return 'leader-done';
      });

      expect(leaderRes.executed).toBe(true);
      if (leaderRes.executed) {
        expect(leaderRes.result).toBe('leader-done');
      }
      expect(leaderExecuted).toBe(true);

      // 2. Second instance attempts while lock is held -> skips without error
      isFirstTransactionHolding = false;
      let followerExecuted = false;
      const followerRes = await withCronLock(CRON_LOCKS.APPOINTMENT_REMINDER, async () => {
        followerExecuted = true;
        return 'follower-done';
      });

      expect(followerRes.executed).toBe(false);
      expect(followerExecuted).toBe(false);
    });
  });

  describe('F-11, F-12: KiotViet Atomic Rate Limit Quota', () => {
    beforeEach(() => {
      vi.spyOn(prisma.kiotvietVendorCooldown, 'findUnique').mockResolvedValue(null);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('reserves slot atomically via SQL increment returning row on success', async () => {
      const orgId = `org-${randomUUID()}`;
      const retailer = 'shop_test';

      const queryRawSpy = vi.spyOn(prisma, '$queryRaw').mockResolvedValue([
        {
          id: 'bucket-1',
          org_id: orgId,
          retailer,
          request_count: 1,
        },
      ]);

      await expect(checkAndReserveRateLimit(orgId, retailer)).resolves.toBeUndefined();
      expect(queryRawSpy).toHaveBeenCalled();
    });

    it('throws KiotvietRateLimitError when atomic reservation fails because limit was reached', async () => {
      const orgId = `org-${randomUUID()}`;
      const retailer = 'shop_test';

      // SQL returns 0 rows (limit reached)
      vi.spyOn(prisma, '$queryRaw').mockResolvedValue([]);
      vi.spyOn(prisma.kiotvietRateLimitBucket, 'findUnique').mockResolvedValue({
        id: 'bucket-1',
        orgId,
        retailer,
        windowStart: new Date(),
        requestCount: 75,
        blockedUntil: null,
        updatedAt: new Date(),
      } as any);

      await expect(checkAndReserveRateLimit(orgId, retailer)).rejects.toThrow(KiotvietRateLimitError);
    });

    it('throws KiotvietRateLimitError with wait time when vendor block is active', async () => {
      const orgId = `org-${randomUUID()}`;
      const retailer = 'shop_test';

      vi.spyOn(prisma, '$queryRaw').mockResolvedValue([]);
      vi.spyOn(prisma.kiotvietVendorCooldown, 'findUnique').mockResolvedValue({
        blockedUntil: new Date(Date.now() + 30_000),
        reason: 'vendor_429',
      } as any);
      vi.spyOn(prisma.kiotvietRateLimitBucket, 'findUnique').mockResolvedValue({
        id: 'bucket-1',
        orgId,
        retailer,
        windowStart: new Date(),
        requestCount: 5,
        blockedUntil: new Date(Date.now() + 30_000),
        updatedAt: new Date(),
      } as any);

      try {
        await checkAndReserveRateLimit(orgId, retailer);
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(KiotvietRateLimitError);
        expect(err.statusCode).toBe(429);
        expect(err.message).toContain('Blocked until');
        expect(err.retryAfterSeconds).toBeGreaterThan(0);
      }
    });
  });

  describe('F-10: Public API Key Hashing & Dual-Lookup Migration', () => {
    let app: FastifyInstance;
    let testOrgId: string;
    const testSecret = 'api_key_test_jwt_secret_32_characters_long!';

    beforeEach(async () => {
      testOrgId = `org-${randomUUID()}`;
      app = Fastify();
      await app.register(import('@fastify/jwt'), { secret: testSecret });
      await app.register(webhookSettingsRoutes);
      await app.register(publicApiRoutes);
      await app.ready();
    });

    afterEach(async () => {
      await app.close();
      vi.restoreAllMocks();
    });

    it('generates API key, stores SHA-256 hash & prefix, and deletes legacy plaintext key', async () => {
      const token = app.jwt.sign({ id: 'user-1', orgId: testOrgId, role: 'owner', sessionId: 'sess-1' });

      vi.spyOn(prisma.authSession, 'findFirst').mockResolvedValue({
        id: 'sess-1',
        userId: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
        user: {
          id: 'user-1',
          email: 'owner@test.com',
          role: 'owner',
          orgId: testOrgId,
          isActive: true,
          fullName: 'Owner',
        },
      } as any);

      let storedHash = '';
      let storedPrefix = '';
      const upsertSpy = vi.spyOn(prisma.appSetting, 'upsert').mockImplementation(async (args: any) => {
        if (args.where.orgId_settingKey.settingKey === 'public_api_key_hash') {
          storedHash = args.create.valuePlain;
        }
        if (args.where.orgId_settingKey.settingKey === 'public_api_key_prefix') {
          storedPrefix = args.create.valuePlain;
        }
        return {} as any;
      });

      const deleteManySpy = vi.spyOn(prisma.appSetting, 'deleteMany').mockResolvedValue({ count: 1 });
      vi.spyOn(prisma.activityLog, 'create').mockResolvedValue({} as any);

      const genRes = await app.inject({
        method: 'POST',
        url: '/api/v1/settings/api-key/generate',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(genRes.statusCode).toBe(200);
      const data = genRes.json();
      expect(data.apiKey).toMatch(/^zcrm_[0-9a-f]{48}$/);
      expect(data.prefix).toBe(data.apiKey.slice(0, 10));

      // Hash verified
      const expectedHash = createHash('sha256').update(data.apiKey).digest('hex');
      expect(storedHash).toBe(expectedHash);
      expect(storedPrefix).toBe(data.prefix);
      expect(deleteManySpy).toHaveBeenCalledWith({
        where: { orgId: testOrgId, settingKey: 'public_api_key' },
      });

      // GET returns masked key with prefix
      vi.spyOn(prisma.appSetting, 'findFirst').mockImplementation(async (args: any) => {
        if (args.where.settingKey === 'public_api_key_hash') {
          return { settingKey: 'public_api_key_hash', valuePlain: storedHash } as any;
        }
        if (args.where.settingKey === 'public_api_key_prefix') {
          return { settingKey: 'public_api_key_prefix', valuePlain: storedPrefix } as any;
        }
        return null;
      });

      const getRes = await app.inject({
        method: 'GET',
        url: '/api/v1/settings/api-key',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(getRes.statusCode).toBe(200);
      const getData = getRes.json();
      expect(getData.key).toContain('••••');
      expect(getData.key.startsWith(data.prefix)).toBe(true);
    });

    it('authenticates with SHA-256 hashed API key on /api/public/ routes', async () => {
      const plainApiKey = `zcrm_${randomUUID().replace(/-/g, '')}`;
      const keyHash = createHash('sha256').update(plainApiKey).digest('hex');

      vi.spyOn(prisma.appSetting, 'findFirst').mockImplementation(async (args: any) => {
        if (args.where.settingKey === 'public_api_key_hash' && args.where.valuePlain === keyHash) {
          return { orgId: testOrgId, settingKey: 'public_api_key_hash' } as any;
        }
        return null;
      });

      vi.spyOn(prisma.contact, 'findMany').mockResolvedValue([]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/public/contacts',
        headers: { 'x-api-key': plainApiKey },
      });

      expect(res.statusCode).toBe(200);
    });

    it('authenticates with legacy plaintext key and performs lazy migration', async () => {
      const legacyApiKey = `zcrm_legacy_key_12345`;
      const expectedHash = createHash('sha256').update(legacyApiKey).digest('hex');

      // Hash lookup returns null, plaintext lookup returns setting
      vi.spyOn(prisma.appSetting, 'findFirst').mockImplementation(async (args: any) => {
        if (args.where.settingKey === 'public_api_key_hash') return null;
        if (args.where.settingKey === 'public_api_key' && args.where.valuePlain === legacyApiKey) {
          return { orgId: testOrgId, settingKey: 'public_api_key' } as any;
        }
        return null;
      });

      const upsertSpy = vi.spyOn(prisma.appSetting, 'upsert').mockResolvedValue({} as any);
      vi.spyOn(prisma, '$transaction').mockResolvedValue([] as any);
      vi.spyOn(prisma.contact, 'findMany').mockResolvedValue([]);
      vi.spyOn(prisma.contact, 'count').mockResolvedValue(0);

      const res = await app.inject({
        method: 'GET',
        url: '/api/public/contacts',
        headers: { 'x-api-key': legacyApiKey },
      });

      expect(res.statusCode).toBe(200);

      // Verify lazy migration was triggered
      expect(upsertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            settingKey: 'public_api_key_hash',
            valuePlain: expectedHash,
          }),
        }),
      );
    });
  });
});
