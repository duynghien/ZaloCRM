process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_long_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';
import Fastify from 'fastify';
import { publicApiRoutes } from '../../src/modules/api/public-api-routes.js';
import { prisma } from '../../src/shared/database/prisma-client.js';

vi.mock('../../src/shared/database/prisma-client.js', () => {
  const mockPrisma: any = {
    appSetting: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
    contact: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  };
  return { prisma: mockPrisma };
});

describe('Public API Key Migration & Plaintext Purge Tests', () => {
  const orgId = 'org-key-purge-test';
  const rawApiKey = 'zalo_live_secret_key_1234567890';
  const hashedKey = crypto.createHash('sha256').update(rawApiKey).digest('hex');
  const prefix = rawApiKey.slice(0, 10);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('purges legacy plaintext key and migrates to hash and prefix upon first authentication', async () => {
    // 1. Initial lookup by hash returns null (key not migrated yet)
    // 2. Fallback lookup by plaintext returns legacy setting
    vi.mocked(prisma.appSetting.findFirst)
      .mockResolvedValueOnce(null) // hash check
      .mockResolvedValueOnce({
        id: 'legacy-setting-id',
        orgId,
        settingKey: 'public_api_key',
        valuePlain: rawApiKey,
      } as any);

    vi.mocked(prisma.$transaction).mockResolvedValueOnce([] as any);

    const app = Fastify();
    await app.register(publicApiRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/public/contacts',
      headers: {
        'x-api-key': rawApiKey,
      },
    });

    // Request was authenticated successfully
    expect(response.statusCode).toBe(200);

    // Verify $transaction was called with upsert hash, upsert prefix, and deleteMany plaintext
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const txOps = vi.mocked(prisma.$transaction).mock.calls[0][0] as any[];
    expect(txOps).toHaveLength(3);

    // Verify deleteMany was issued for public_api_key
    expect(prisma.appSetting.deleteMany).toHaveBeenCalledWith({
      where: {
        orgId,
        settingKey: 'public_api_key',
      },
    });

    // Verify upsert was called for hash
    expect(prisma.appSetting.upsert).toHaveBeenCalledWith({
      where: { orgId_settingKey: { orgId, settingKey: 'public_api_key_hash' } },
      create: { orgId, settingKey: 'public_api_key_hash', valuePlain: hashedKey },
      update: { valuePlain: hashedKey },
    });

    // Verify upsert was called for prefix
    expect(prisma.appSetting.upsert).toHaveBeenCalledWith({
      where: { orgId_settingKey: { orgId, settingKey: 'public_api_key_prefix' } },
      create: { orgId, settingKey: 'public_api_key_prefix', valuePlain: prefix },
      update: { valuePlain: prefix },
    });
  });

  it('authenticates directly via hash when already migrated without querying plaintext', async () => {
    // Hash check finds the record immediately
    vi.mocked(prisma.appSetting.findFirst).mockResolvedValueOnce({
      id: 'hash-setting-id',
      orgId,
      settingKey: 'public_api_key_hash',
      valuePlain: hashedKey,
    } as any);

    const app = Fastify();
    await app.register(publicApiRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/public/contacts',
      headers: {
        'x-api-key': rawApiKey,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(prisma.appSetting.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
