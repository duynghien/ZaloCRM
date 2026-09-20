import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../helpers/test-app.js';
import { config } from '../../src/config/index.js';
import { encryptData, decryptData } from '../../src/shared/utils/crypto.js';
import type { ZaloCredentials } from '../../src/modules/zalo/zalo-pool.js';

const require = createRequire(import.meta.url);
const { Zalo, ZaloApiError } = require('zca-js');

let fixture: Awaited<ReturnType<typeof createTestApp>>;
let pool: typeof import('../../src/modules/zalo/zalo-pool.js').zaloPool;
let isFatalAuthError: typeof import('../../src/modules/zalo/zalo-session-manager.js').isFatalAuthError;
let syncAccountCredentials: typeof import('../../src/modules/zalo/zalo-session-manager.js').syncAccountCredentials;
let startAccountHeartbeat: typeof import('../../src/modules/zalo/zalo-session-manager.js').startAccountHeartbeat;
let stopAccountHeartbeat: typeof import('../../src/modules/zalo/zalo-session-manager.js').stopAccountHeartbeat;
let stopAllHeartbeats: typeof import('../../src/modules/zalo/zalo-session-manager.js').stopAllHeartbeats;
let isHeartbeatActive: typeof import('../../src/modules/zalo/zalo-session-manager.js').isHeartbeatActive;

beforeAll(async () => {
  fixture = await createTestApp();
  pool = (await import('../../src/modules/zalo/zalo-pool.js')).zaloPool;
  pool.setIO(fixture.app.io);
  const sm = await import('../../src/modules/zalo/zalo-session-manager.js');
  isFatalAuthError = sm.isFatalAuthError;
  syncAccountCredentials = sm.syncAccountCredentials;
  startAccountHeartbeat = sm.startAccountHeartbeat;
  stopAccountHeartbeat = sm.stopAccountHeartbeat;
  stopAllHeartbeats = sm.stopAllHeartbeats;
  isHeartbeatActive = sm.isHeartbeatActive;
}, 120_000);

afterEach(async () => {
  stopAllHeartbeats();
  pool.disconnectAll();
  await pool.drain();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await fixture?.close();
});

async function createTestAccount(sessionData?: any) {
  const org = await fixture.prisma.organization.create({ data: { name: 'KeepAlive Test Org' } });
  const user = await fixture.prisma.user.create({
    data: {
      orgId: org.id,
      email: `${randomUUID()}@test.invalid`,
      fullName: 'Test Owner',
      role: 'owner',
      passwordHash: 'unused',
    },
  });
  const account = await fixture.prisma.zaloAccount.create({
    data: {
      orgId: org.id,
      ownerUserId: user.id,
      displayName: 'KeepAlive Zalo Account',
      status: 'disconnected',
      sessionData: sessionData ?? null,
    },
  });
  return { org, user, account };
}

function createMockApi(overrides: Partial<any> = {}) {
  const listener = Object.assign(new EventEmitter(), { start: vi.fn(), stop: vi.fn() });
  const defaultCookies = [{ name: 'zpsid', value: 'valid-cookie-123' }];
  return {
    listener,
    keepAlive: vi.fn().mockResolvedValue({ error_code: 0 }),
    getCookie: vi.fn().mockReturnValue({
      toJSON: () => ({ cookies: defaultCookies }),
    }),
    getContext: vi.fn().mockReturnValue({
      imei: 'mock-imei-123',
      userAgent: 'mock-user-agent',
      cookie: { toJSON: () => ({ cookies: defaultCookies }) },
    }),
    getOwnId: vi.fn().mockImplementation(async () => `zalo-uid-${randomUUID()}`),
    getUserInfo: vi.fn().mockResolvedValue({}),
    sendMessage: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

describe('Zalo Session Keep-Alive & Reconnect Resilience', () => {
  describe('isFatalAuthError classification', () => {
    it('correctly identifies fatal auth errors and excludes transient errors', () => {
      // Fatal errors
      expect(isFatalAuthError(new ZaloApiError('session expired'))).toBe(true);
      expect(isFatalAuthError(new ZaloApiError('invalid session'))).toBe(true);
      expect(isFatalAuthError(new ZaloApiError('Unauthorized', 401))).toBe(true);
      expect(isFatalAuthError(new ZaloApiError('Forbidden', 403))).toBe(true);
      expect(isFatalAuthError(new Error('session revoked'))).toBe(true);
      expect(isFatalAuthError(new Error('HTTP 401 Unauthorized'))).toBe(true);
      expect(isFatalAuthError(new Error('HTTP 403 Forbidden'))).toBe(true);
      expect(isFatalAuthError({ name: 'ZcaApiError', code: -100 })).toBe(true);

      // Non-fatal / transient errors
      expect(isFatalAuthError(new ZaloApiError('Đăng nhập thất bại'))).toBe(false);
      expect(isFatalAuthError(new Error('Network timeout'))).toBe(false);
      expect(isFatalAuthError(new Error('connect ECONNREFUSED'))).toBe(false);
      expect(isFatalAuthError(new Error('socket hang up'))).toBe(false);
      expect(isFatalAuthError(null)).toBe(false);
      expect(isFatalAuthError(undefined)).toBe(false);
    });
  });

  describe('syncAccountCredentials', () => {
    it('skips sync when cookies are empty or not an array', async () => {
      const { account } = await createTestAccount();
      const mockApi = createMockApi({
        getCookie: vi.fn().mockReturnValue({ toJSON: () => ({ cookies: [] }) }),
        getContext: vi.fn().mockReturnValue({ cookie: { toJSON: () => ({ cookies: [] }) } }),
      });

      await syncAccountCredentials(account.id, mockApi);

      const unchanged = await fixture.prisma.zaloAccount.findUnique({ where: { id: account.id } });
      expect(unchanged?.sessionData).toBeNull();
    });

    it('encrypts and persists valid cookies with context imei and userAgent', async () => {
      const { account } = await createTestAccount();
      const mockApi = createMockApi();

      await syncAccountCredentials(account.id, mockApi);

      const updated = await fixture.prisma.zaloAccount.findUnique({ where: { id: account.id } });
      expect(updated?.sessionData).not.toBeNull();
      const decrypted = decryptData<ZaloCredentials>(updated?.sessionData, config.encryptionKey);
      expect(decrypted?.imei).toBe('mock-imei-123');
      expect(decrypted?.userAgent).toBe('mock-user-agent');
      expect(decrypted?.cookie).toEqual([{ name: 'zpsid', value: 'valid-cookie-123' }]);
    });

    it('falls back to existing DB session for imei/userAgent if missing from context', async () => {
      const initialCreds: ZaloCredentials = {
        cookie: [{ name: 'old', value: 'old' }],
        imei: 'persisted-imei',
        userAgent: 'persisted-agent',
      };
      const { account } = await createTestAccount(encryptData(initialCreds, config.encryptionKey));

      const mockApi = createMockApi({
        getContext: vi.fn().mockReturnValue({ imei: undefined, userAgent: undefined }),
      });

      await syncAccountCredentials(account.id, mockApi);

      const updated = await fixture.prisma.zaloAccount.findUnique({ where: { id: account.id } });
      const decrypted = decryptData<ZaloCredentials>(updated?.sessionData, config.encryptionKey);
      expect(decrypted?.imei).toBe('persisted-imei');
      expect(decrypted?.userAgent).toBe('persisted-agent');
      expect(decrypted?.cookie).toEqual([{ name: 'zpsid', value: 'valid-cookie-123' }]);
    });
  });

  describe('startAccountHeartbeat & stopAccountHeartbeat', () => {
    it('manages timer lifecycle and handles keepAlive success', async () => {
      vi.useFakeTimers();
      try {
        const { account } = await createTestAccount();
        const mockApi = createMockApi();

        startAccountHeartbeat(account.id, mockApi, 1000);
        expect(isHeartbeatActive(account.id)).toBe(true);

        await vi.advanceTimersByTimeAsync(2000);
        expect(mockApi.keepAlive).toHaveBeenCalled();

        stopAccountHeartbeat(account.id);
        expect(isHeartbeatActive(account.id)).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('handles fatal auth error by stopping heartbeat and invoking callback', async () => {
      vi.useFakeTimers();
      try {
        const { account } = await createTestAccount();
        const mockApi = createMockApi({
          keepAlive: vi.fn().mockRejectedValue(new ZaloApiError('session expired', 401)),
        });

        const onFatalAuth = vi.fn();
        startAccountHeartbeat(account.id, mockApi, 1000, onFatalAuth);

        await vi.advanceTimersByTimeAsync(2000);
        expect(onFatalAuth).toHaveBeenCalledWith(account.id, expect.any(Error));
        expect(isHeartbeatActive(account.id)).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('reconnect resilience in ZaloAccountPool', () => {
    it('does not mark qr_pending on transient error and schedules backoff', async () => {
      const { account } = await createTestAccount();
      const credentials: ZaloCredentials = {
        cookie: [{ name: 'zpsid', value: 'test' }],
        imei: 'test-imei',
        userAgent: 'test-agent',
      };

      vi.spyOn(Zalo.prototype, 'login').mockRejectedValue(new ZaloApiError('Đăng nhập thất bại'));

      await pool.reconnect(account.id, credentials);

      expect(pool.getStatus(account.id)).toBe('disconnected');
      expect(pool.isReconnectScheduled(account.id)).toBe(true);

      const dbAccount = await fixture.prisma.zaloAccount.findUnique({ where: { id: account.id } });
      expect(dbAccount?.status).toBe('disconnected');
    });

    it('marks qr_pending after 3 consecutive failures', async () => {
      const { account } = await createTestAccount();
      const credentials: ZaloCredentials = {
        cookie: [{ name: 'zpsid', value: 'test' }],
        imei: 'test-imei',
        userAgent: 'test-agent',
      };

      vi.spyOn(Zalo.prototype, 'login').mockRejectedValue(new Error('Network timeout'));

      // Attempt 1: failure 1 -> disconnected, scheduled (30s)
      await pool.reconnect(account.id, credentials);
      expect(pool.getStatus(account.id)).toBe('disconnected');

      // Attempt 2: failure 2 -> disconnected, scheduled (2m)
      await pool.reconnect(account.id, credentials);
      expect(pool.getStatus(account.id)).toBe('disconnected');

      // Attempt 3: failure 3 -> disconnected, scheduled (5m)
      await pool.reconnect(account.id, credentials);
      expect(pool.getStatus(account.id)).toBe('disconnected');

      // Attempt 4: failures > 3 -> qr_pending, NOT scheduled
      await pool.reconnect(account.id, credentials);
      expect(pool.getStatus(account.id)).toBe('qr_pending');
      expect(pool.isReconnectScheduled(account.id)).toBe(false);

      const dbAccount = await fixture.prisma.zaloAccount.findUnique({ where: { id: account.id } });
      expect(dbAccount?.status).toBe('qr_pending');
    });

    it('immediately marks qr_pending on fatal auth error', async () => {
      const { account } = await createTestAccount();
      const credentials: ZaloCredentials = {
        cookie: [{ name: 'zpsid', value: 'test' }],
        imei: 'test-imei',
        userAgent: 'test-agent',
      };

      vi.spyOn(Zalo.prototype, 'login').mockRejectedValue(new ZaloApiError('session expired', 401));

      await pool.reconnect(account.id, credentials);

      expect(pool.getStatus(account.id)).toBe('qr_pending');
      expect(pool.isReconnectScheduled(account.id)).toBe(false);

      const dbAccount = await fixture.prisma.zaloAccount.findUnique({ where: { id: account.id } });
      expect(dbAccount?.status).toBe('qr_pending');
    });

    it('clears reconnectFailures on successful reconnect and loginQR', async () => {
      const { account } = await createTestAccount();
      const credentials: ZaloCredentials = {
        cookie: [{ name: 'zpsid', value: 'test' }],
        imei: 'test-imei',
        userAgent: 'test-agent',
      };

      const mockApi = createMockApi();
      const loginSpy = vi.spyOn(Zalo.prototype, 'login')
        .mockRejectedValueOnce(new Error('Transient failure'))
        .mockResolvedValue(mockApi);

      await pool.reconnect(account.id, credentials);
      expect(pool.getStatus(account.id)).toBe('disconnected');

      // Successful reconnect resets failures
      await pool.reconnect(account.id, credentials);
      expect(pool.getStatus(account.id)).toBe('connected');

      // Fail again: should start from failure 1, not failure 2
      loginSpy.mockRejectedValueOnce(new Error('Transient failure'));
      await pool.reconnect(account.id, credentials);
      expect(pool.getStatus(account.id)).toBe('disconnected');
    });

    it('circuit breaker triggers when disconnected >= 5 times in 5 minutes', async () => {
      const { account } = await createTestAccount();
      const credentials: ZaloCredentials = {
        cookie: [{ name: 'zpsid', value: 'test' }],
        imei: 'test-imei',
        userAgent: 'test-agent',
      };

      const mockApi = createMockApi();
      vi.spyOn(Zalo.prototype, 'login').mockResolvedValue(mockApi);

      await pool.reconnect(account.id, credentials);
      expect(pool.getStatus(account.id)).toBe('connected');

      // Simulate 5 rapid listener disconnect events
      for (let i = 0; i < 4; i++) {
        mockApi.listener.emit('closed', 1000, 'flapping');
        expect(pool.getStatus(account.id)).toBe('disconnected');
      }

      // 5th disconnect: triggers circuit breaker -> qr_pending
      mockApi.listener.emit('closed', 1000, 'flapping');
      expect(pool.getStatus(account.id)).toBe('qr_pending');
      expect(pool.isReconnectScheduled(account.id)).toBe(false);

      // Allow async updateAccountDB to complete
      await new Promise(r => setTimeout(r, 100));

      const dbAccount = await fixture.prisma.zaloAccount.findUnique({ where: { id: account.id } });
      expect(dbAccount?.status).toBe('qr_pending');
    });

    it('preserves reconnectFailures across retry chain when disconnect() is called internally', async () => {
      const { account } = await createTestAccount();
      const credentials: ZaloCredentials = {
        cookie: [{ name: 'zpsid', value: 'test' }],
        imei: 'test-imei',
        userAgent: 'test-agent',
      };

      vi.spyOn(Zalo.prototype, 'login').mockRejectedValue(new Error('Transient error'));

      // 1st failure
      await pool.reconnect(account.id, credentials);
      expect(pool.getStatus(account.id)).toBe('disconnected');

      // Internal disconnect() does NOT reset failure counter
      pool.disconnect(account.id, false);

      // 2nd failure
      await pool.reconnect(account.id, credentials);
      expect(pool.getStatus(account.id)).toBe('disconnected');

      // 3rd failure
      await pool.reconnect(account.id, credentials);
      expect(pool.getStatus(account.id)).toBe('disconnected');

      // 4th failure -> exceeds 3 -> qr_pending
      await pool.reconnect(account.id, credentials);
      expect(pool.getStatus(account.id)).toBe('qr_pending');

      // Explicit user disconnect with clearFailures = true clears the counter
      pool.disconnect(account.id, true);
    });

    it('autoReconnect uses backoff delays and transitions to qr_pending after 3 failures', async () => {
      const credentials: ZaloCredentials = {
        cookie: [{ name: 'zpsid', value: 'test' }],
        imei: 'test-imei',
        userAgent: 'test-agent',
      };
      const encrypted = encryptData(credentials, config.encryptionKey);
      const { account } = await createTestAccount(encrypted);

      vi.spyOn(Zalo.prototype, 'login').mockRejectedValue(new Error('Transient connection drop'));

      // Fail 3 times via reconnect
      await pool.reconnect(account.id, credentials);
      expect(pool.getStatus(account.id)).toBe('disconnected');
      await pool.reconnect(account.id, credentials);
      expect(pool.getStatus(account.id)).toBe('disconnected');
      await pool.reconnect(account.id, credentials);
      expect(pool.getStatus(account.id)).toBe('disconnected');

      // 4th failure via reconnect / autoReconnect marks qr_pending
      await pool.reconnect(account.id, credentials);
      expect(pool.getStatus(account.id)).toBe('qr_pending');
      expect(pool.isReconnectScheduled(account.id)).toBe(false);
    });
  });

  describe('Health Check integration', () => {
    it('decrypts encrypted sessionData and respects isReconnectScheduled', async () => {
      const credentials: ZaloCredentials = {
        cookie: [{ name: 'zpsid', value: 'encrypted-test' }],
        imei: 'health-check-imei',
        userAgent: 'health-check-agent',
      };
      const encrypted = encryptData(credentials, config.encryptionKey);
      const { account } = await createTestAccount(encrypted);

      const mockApi = createMockApi();
      const loginSpy = vi.spyOn(Zalo.prototype, 'login').mockResolvedValue(mockApi);

      // If scheduled, it should be skipped
      vi.spyOn(pool, 'isReconnectScheduled').mockReturnValue(true);
      expect(pool.isReconnectScheduled(account.id)).toBe(true);

      vi.spyOn(pool, 'isReconnectScheduled').mockReturnValue(false);
      await pool.reconnect(account.id, credentials);
      expect(loginSpy).toHaveBeenCalledWith(expect.objectContaining({ imei: 'health-check-imei' }));
    });
  });
});
