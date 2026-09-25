/**
 * zalo-reconnect-observability.test.ts
 * Unit tests for Zalo reconnect observability, sanitized logging, and QR login identity guard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  zaloPool,
  sanitizeZaloError,
  setZaloFactoryForTesting,
  ZaloAccountPool,
  type ZaloCredentials,
} from '../../src/modules/zalo/zalo-pool.js';
import { prisma } from '../../src/shared/database/prisma-client.js';
import { logger } from '../../src/shared/utils/logger.js';
import * as socketDelivery from '../../src/shared/realtime/socket-event-delivery.js';

describe('zalo-reconnect-observability', () => {
  const accountId = 'acc-test-reconnect-123';
  const orgId = 'org-test-123';
  const credentials: ZaloCredentials = {
    cookie: { zpw_sek: 'secret_token_123' },
    imei: 'imei-secret-456',
    userAgent: 'Mozilla/5.0 TestAgent',
  };

  let mockZalo: any;
  let emitAccountEventSpy: any;
  let warnSpy: any;
  let errorSpy: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    (zaloPool as any).instances.clear();
    (zaloPool as any).reconnectFailures.clear();
    (zaloPool as any).reconnectTimers.clear();
    (zaloPool as any).connectionAttempts.clear();

    emitAccountEventSpy = vi.spyOn(socketDelivery, 'emitAccountEvent').mockResolvedValue(undefined);
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(prisma.notification, 'updateMany').mockResolvedValue({ count: 0 } as any);

    // Mock IO on pool so emitForAccount executes emitAccountEvent
    (zaloPool as any).io = {
      to: () => ({ emit: vi.fn() }),
      sockets: { adapter: { rooms: new Map() } },
    } as any;

    mockZalo = {
      login: vi.fn(),
      loginQR: vi.fn(),
    };

    setZaloFactoryForTesting(() => mockZalo);
  });

  afterEach(() => {
    setZaloFactoryForTesting(null);
    zaloPool.disconnectAll();
  });

  describe('sanitizeZaloError', () => {
    it('redacts imei and signkey in query parameters', () => {
      const rawError = 'Failed request: https://api.zalo.me/v1/auth?imei=849012345678&signkey=very_secret_sign_key_999&other=123';
      const sanitized = sanitizeZaloError(rawError);
      expect(sanitized).not.toContain('849012345678');
      expect(sanitized).not.toContain('very_secret_sign_key_999');
      expect(sanitized).toContain('imei=[REDACTED]');
      expect(sanitized).toContain('signkey=[REDACTED]');
      expect(sanitized).toContain('other=123');
    });

    it('redacts cookie strings from error messages', () => {
      const rawError = 'Request headers: cookie: zpw_sek=top_secret_cookie_val; path=/';
      const sanitized = sanitizeZaloError(rawError);
      expect(sanitized).not.toContain('top_secret_cookie_val');
      expect(sanitized).toContain('cookie:[REDACTED]');
    });

    it('handles Error objects and non-string inputs', () => {
      const errObj = new Error('Network error with imei=sensitive_imei_123');
      expect(sanitizeZaloError(errObj)).toBe('Network error with imei=[REDACTED]');

      expect(sanitizeZaloError({ custom: 'object' })).toBe('[object Object]');
    });
  });

  describe('reconnect observability and retry lifecycle', () => {
    it('records warning log, keeps disconnected status, and emits client-safe error on attempt 1 failure', async () => {
      vi.spyOn(prisma.zaloAccount, 'findUnique').mockResolvedValue({
        id: accountId,
        orgId,
        displayName: 'Test Account',
        zaloUid: 'uid-123',
      } as any);
      vi.spyOn(prisma.zaloAccount, 'update').mockResolvedValue({} as any);

      mockZalo.login.mockRejectedValue(new Error('Connection timeout with imei=leak_imei_123'));

      await zaloPool.reconnect(accountId, credentials);

      // Check reconnect failure count
      const failures = (zaloPool as any).reconnectFailures.get(accountId);
      expect(failures).toBe(1);

      // Verify sanitized structured warning log
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`[zalo:${accountId}] Reconnect attempt 1/3 failed: Connection timeout with imei=[REDACTED]`)
      );

      // Status should be disconnected
      expect(zaloPool.getStatus(accountId)).toBe('disconnected');

      // Client-safe error message emitted
      expect(emitAccountEventSpy).toHaveBeenCalledWith(
        expect.anything(),
        accountId,
        'zalo:reconnect-failed',
        { accountId, error: 'Đang thử kết nối lại...' }
      );
    });

    it('transitions to qr_pending and emits client-safe expiry message when max retry attempts reached', async () => {
      vi.spyOn(prisma.zaloAccount, 'findUnique').mockResolvedValue({
        id: accountId,
        orgId,
        displayName: 'Test Account',
        zaloUid: 'uid-123',
      } as any);
      const updateSpy = vi.spyOn(prisma.zaloAccount, 'update').mockResolvedValue({} as any);

      // Pre-set failure count to 3 so next failure triggers max retry (>3)
      (zaloPool as any).reconnectFailures.set(accountId, 3);

      mockZalo.login.mockRejectedValue(new Error('Auth rejected signkey=leaked_key_abc'));

      await zaloPool.reconnect(accountId, credentials);

      // Failures incremented to 4 (> BACKOFF_DELAYS.length)
      expect((zaloPool as any).reconnectFailures.get(accountId)).toBe(4);

      // Log warning for max attempts reached with sanitized error
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`[zalo:${accountId}] Max reconnect attempts reached or fatal auth error, switching to qr_pending: Auth rejected signkey=[REDACTED]`)
      );

      // Instance status transitioned to qr_pending
      expect(zaloPool.getStatus(accountId)).toBe('qr_pending');

      // DB updated with qr_pending
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: accountId },
          data: expect.objectContaining({ status: 'qr_pending' }),
        })
      );

      // Client-safe reconnect-failed message emitted
      expect(emitAccountEventSpy).toHaveBeenCalledWith(
        expect.anything(),
        accountId,
        'zalo:reconnect-failed',
        {
          accountId,
          error: 'Phiên đăng nhập Zalo đã hết hạn. Vui lòng quét lại mã QR để tiếp tục.',
        }
      );
    });

    it('immediately transitions to qr_pending when error is a fatal auth error (-201)', async () => {
      vi.spyOn(prisma.zaloAccount, 'findUnique').mockResolvedValue({
        id: accountId,
        orgId,
        displayName: 'Test Account',
        zaloUid: 'uid-123',
      } as any);
      vi.spyOn(prisma.zaloAccount, 'update').mockResolvedValue({} as any);

      // -201 is isFatalAuthError
      mockZalo.login.mockRejectedValue(new Error('Zalo session expired code=-201'));

      await zaloPool.reconnect(accountId, credentials);

      expect(zaloPool.getStatus(accountId)).toBe('qr_pending');
      expect(emitAccountEventSpy).toHaveBeenCalledWith(
        expect.anything(),
        accountId,
        'zalo:reconnect-failed',
        {
          accountId,
          error: 'Phiên đăng nhập Zalo đã hết hạn. Vui lòng quét lại mã QR để tiếp tục.',
        }
      );
    });
  });

  describe('loginQR identity guard', () => {
    it('aborts and emits error when scanned QR account mismatches existing zaloUid', async () => {
      const existingZaloUid = 'original-owner-uid-111';
      const scannedOtherUid = 'intruder-scanned-uid-222';

      vi.spyOn(prisma.zaloAccount, 'findUnique').mockResolvedValue({
        id: accountId,
        orgId,
        displayName: 'Duy Nguyễn',
        zaloUid: existingZaloUid,
      } as any);
      const updateSpy = vi.spyOn(prisma.zaloAccount, 'update').mockResolvedValue({} as any);

      const mockApi = {
        getOwnId: vi.fn().mockResolvedValue(scannedOtherUid),
        listener: { stop: vi.fn() },
      };

      mockZalo.loginQR.mockImplementation(async (_opts: any, eventCallback: any) => {
        // Emit GotLoginInfo before login completes
        eventCallback({
          type: 4,
          data: {
            cookie: { zpw_sek: 'intruder_cookie' },
            imei: 'intruder_imei',
            userAgent: 'Intruder Agent',
          },
        });
        return mockApi;
      });

      await zaloPool.loginQR(accountId);

      // Verify error logged
      expect(errorSpy).toHaveBeenCalledWith(
        `[zalo:${accountId}] QR scan identity mismatch: expected ${existingZaloUid}, got ${scannedOtherUid}`
      );

      // Listener stopped and disconnected
      expect(mockApi.listener.stop).toHaveBeenCalled();
      expect(zaloPool.getStatus(accountId)).toBe('disconnected');

      // Emitted mismatch error
      expect(emitAccountEventSpy).toHaveBeenCalledWith(
        expect.anything(),
        accountId,
        'zalo:error',
        {
          accountId,
          error: 'Tài khoản Zalo quét không khớp với tài khoản đã liên kết.',
        }
      );

      // DB must NOT be updated with the intruder UID, connected status, or sessionData
      expect(updateSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: accountId },
          data: expect.objectContaining({ zaloUid: scannedOtherUid }),
        })
      );
      expect(updateSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: accountId },
          data: expect.objectContaining({ sessionData: expect.anything() }),
        })
      );
    });

    it('successfully connects when scanned QR account matches existing zaloUid', async () => {
      const existingZaloUid = 'original-owner-uid-111';

      vi.spyOn(prisma.zaloAccount, 'findUnique').mockResolvedValue({
        id: accountId,
        orgId,
        displayName: 'Duy Nguyễn',
        zaloUid: existingZaloUid,
      } as any);
      const updateSpy = vi.spyOn(prisma.zaloAccount, 'update').mockResolvedValue({} as any);

      const mockApi = {
        getOwnId: vi.fn().mockResolvedValue(existingZaloUid),
        getUserInfo: vi.fn().mockResolvedValue({ changed_profiles: {} }),
        listener: { on: vi.fn(), start: vi.fn(), stop: vi.fn() },
      };

      mockZalo.loginQR.mockResolvedValue(mockApi);

      await zaloPool.loginQR(accountId);

      expect(zaloPool.getStatus(accountId)).toBe('connected');
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: accountId },
          data: expect.objectContaining({ status: 'connected', zaloUid: existingZaloUid }),
        })
      );
      expect(emitAccountEventSpy).toHaveBeenCalledWith(
        expect.anything(),
        accountId,
        'zalo:connected',
        { accountId, zaloUid: existingZaloUid }
      );
    });

    it('allows initial linking when existing zaloUid is null', async () => {
      const newlyScannedUid = 'first-time-owner-uid-333';

      vi.spyOn(prisma.zaloAccount, 'findUnique').mockResolvedValue({
        id: accountId,
        orgId,
        displayName: 'New Account',
        zaloUid: null,
      } as any);
      const updateSpy = vi.spyOn(prisma.zaloAccount, 'update').mockResolvedValue({} as any);

      const mockApi = {
        getOwnId: vi.fn().mockResolvedValue(newlyScannedUid),
        getUserInfo: vi.fn().mockResolvedValue({ changed_profiles: {} }),
        listener: { on: vi.fn(), start: vi.fn(), stop: vi.fn() },
      };

      mockZalo.loginQR.mockResolvedValue(mockApi);

      await zaloPool.loginQR(accountId);

      expect(zaloPool.getStatus(accountId)).toBe('connected');
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: accountId },
          data: expect.objectContaining({ status: 'connected', zaloUid: newlyScannedUid }),
        })
      );
    });
  });
});
