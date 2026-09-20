process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_long_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getAppSetting,
  getDecryptedAppSetting,
  invalidateAppSetting,
  clearAppSettingCache,
  getAppSettingCacheSize,
} from '../../src/shared/settings/app-setting-service.js';
import { prisma } from '../../src/shared/database/prisma-client.js';
import { encodeSecureSetting } from '../../src/shared/settings/secure-setting-codec.js';

vi.mock('../../src/shared/database/prisma-client.js', () => ({
  prisma: {
    appSetting: {
      findUnique: vi.fn(),
    },
  },
}));

describe('AppSetting In-Memory Bounded LRU Cache', () => {
  beforeEach(() => {
    clearAppSettingCache();
    vi.clearAllMocks();
  });

  it('caches plain JSON settings and hits cache on subsequent calls', async () => {
    const mockData = { copilotEnabled: true, copilotDebounceMs: 3000 };
    (prisma.appSetting.findUnique as any).mockResolvedValueOnce({
      orgId: 'org-1',
      settingKey: 'copilot_settings',
      valuePlain: JSON.stringify(mockData),
      valueEncrypted: null,
    });

    const first = await getAppSetting('org-1', 'copilot_settings');
    expect(first).toEqual(mockData);
    expect(prisma.appSetting.findUnique).toHaveBeenCalledTimes(1);

    // Second call should hit cache, not call DB
    const second = await getAppSetting('org-1', 'copilot_settings');
    expect(second).toEqual(mockData);
    expect(prisma.appSetting.findUnique).toHaveBeenCalledTimes(1);
  });

  it('provides defensive copy to prevent cache mutation', async () => {
    const mockData = { nested: { count: 1 } };
    (prisma.appSetting.findUnique as any).mockResolvedValueOnce({
      orgId: 'org-1',
      settingKey: 'test_key',
      valuePlain: JSON.stringify(mockData),
      valueEncrypted: null,
    });

    const first = await getAppSetting('org-1', 'test_key');
    first.nested.count = 999;

    const second = await getAppSetting('org-1', 'test_key');
    expect(second.nested.count).toBe(1);
  });

  it('caches decrypted secrets and hits cache on subsequent calls', async () => {
    const secretValue = 'super_secret_api_key_123';
    const encoded = encodeSecureSetting(secretValue);

    (prisma.appSetting.findUnique as any).mockResolvedValueOnce({
      orgId: 'org-1',
      settingKey: 'ai_provider_config',
      valuePlain: encoded.valuePlain,
      valueEncrypted: encoded.valueEncrypted,
    });

    const first = await getDecryptedAppSetting('org-1', 'ai_provider_config');
    expect(first).toBe(secretValue);
    expect(prisma.appSetting.findUnique).toHaveBeenCalledTimes(1);

    const second = await getDecryptedAppSetting('org-1', 'ai_provider_config');
    expect(second).toBe(secretValue);
    expect(prisma.appSetting.findUnique).toHaveBeenCalledTimes(1);
  });

  it('invalidates cache on explicit invalidation call', async () => {
    const mockData = { key: 'val1' };
    (prisma.appSetting.findUnique as any)
      .mockResolvedValueOnce({
        orgId: 'org-1',
        settingKey: 'test_key',
        valuePlain: JSON.stringify(mockData),
      })
      .mockResolvedValueOnce({
        orgId: 'org-1',
        settingKey: 'test_key',
        valuePlain: JSON.stringify({ key: 'val2' }),
      });

    await getAppSetting('org-1', 'test_key');
    expect(prisma.appSetting.findUnique).toHaveBeenCalledTimes(1);

    invalidateAppSetting('org-1', 'test_key');

    const refreshed = await getAppSetting('org-1', 'test_key');
    expect(refreshed).toEqual({ key: 'val2' });
    expect(prisma.appSetting.findUnique).toHaveBeenCalledTimes(2);
  });
});
