import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  splitReportForZalo,
  sendReportToZalo,
  _clearPhoneToUidCache,
} from '../src/modules/ai-reports/zalo-report-sender.js';
import { zaloPool } from '../src/modules/zalo/zalo-pool.js';
import { zaloRateLimiter } from '../src/modules/zalo/zalo-rate-limiter.js';
import { prisma } from '../src/shared/database/prisma-client.js';

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: {
    zaloAccount: {
      findFirst: vi.fn(),
    },
    contact: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../src/modules/zalo/zalo-pool.js', () => ({
  zaloPool: {
    getApi: vi.fn(),
    getSend2MeId: vi.fn(),
  },
}));

vi.mock('../src/modules/zalo/zalo-rate-limiter.js', () => ({
  zaloRateLimiter: {
    checkLimits: vi.fn(),
    recordSend: vi.fn(),
  },
}));

describe('zalo-report-sender', () => {
  const accountId = 'acc-test-sender';
  const orgId = 'org-test-sender';
  const mockApi = {
    sendMessage: vi.fn(),
    findUser: vi.fn(),
    getContext: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    _clearPhoneToUidCache();
    vi.mocked(prisma.zaloAccount.findFirst).mockResolvedValue({
      id: accountId,
      orgId,
      status: 'connected',
      zaloUid: 'self-zalo-uid-123',
    } as any);
    vi.mocked(zaloPool.getApi).mockReturnValue(mockApi as any);
    vi.mocked(zaloPool.getSend2MeId).mockReturnValue('send2me-id-999');
    vi.mocked(zaloRateLimiter.checkLimits).mockReturnValue({ allowed: true });
    mockApi.sendMessage.mockResolvedValue({ messageId: 'msg-1' });
  });

  describe('splitReportForZalo', () => {
    it('returns single chunk unmodified when content is small', () => {
      const text = 'Báo cáo kiểm tra đơn giản';
      const parts = splitReportForZalo(text, 100);
      expect(parts).toEqual([text]);
    });

    it('splits long content and adds audit prefix when requested', () => {
      const paragraph = 'Đoạn văn bản kiểm tra đánh giá tuân thủ quy trình làm việc.\n';
      const text = paragraph.repeat(10);
      const parts = splitReportForZalo(text, 200, 'audit');

      expect(parts.length).toBeGreaterThan(1);
      expect(parts[0]).toContain('📋 [ĐÁNH GIÁ TUÂN THỦ - PHẦN 1/');
      expect(parts[1]).toContain('📋 [ĐÁNH GIÁ TUÂN THỦ - PHẦN 2/');
    });

    it('splits long content with default digest prefix', () => {
      const paragraph = 'Báo cáo điều hành hàng ngày.\n';
      const text = paragraph.repeat(10);
      const parts = splitReportForZalo(text, 200);

      expect(parts.length).toBeGreaterThan(1);
      expect(parts[0]).toContain('📋 [BÁO CÁO ĐIỀU HÀNH - PHẦN 1/');
    });
  });

  describe('sendReportToZalo', () => {
    it('dispatches to Zalo group with threadType = 1', async () => {
      const result = await sendReportToZalo({
        accountId,
        orgId,
        destinationType: 'group',
        targetThreadId: 'group-thread-456',
        markdownContent: 'Nội dung báo cáo gửi nhóm',
        executionGuard: vi.fn().mockResolvedValue(undefined),
      });

      expect(result.success).toBe(true);
      expect(result.partsSent).toBe(1);
      expect(mockApi.sendMessage).toHaveBeenCalledWith(
        { msg: 'Nội dung báo cáo gửi nhóm' },
        'group-thread-456',
        1,
      );
    });

    it('dispatches to individual UID with threadType = 0', async () => {
      const result = await sendReportToZalo({
        accountId,
        orgId,
        destinationType: 'uid',
        targetUid: 'user-uid-789',
        markdownContent: 'Nội dung gửi cá nhân',
        executionGuard: vi.fn().mockResolvedValue(undefined),
      });

      expect(result.success).toBe(true);
      expect(mockApi.sendMessage).toHaveBeenCalledWith(
        { msg: 'Nội dung gửi cá nhân' },
        'user-uid-789',
        0,
      );
    });

    it('dispatches to self / cloud with threadType = 0 using send2meId', async () => {
      const result = await sendReportToZalo({
        accountId,
        orgId,
        destinationType: 'self',
        markdownContent: 'Gửi về Cloud',
        executionGuard: vi.fn().mockResolvedValue(undefined),
      });

      expect(result.success).toBe(true);
      expect(mockApi.sendMessage).toHaveBeenCalledWith(
        { msg: 'Gửi về Cloud' },
        'send2me-id-999',
        0,
      );
    });

    it('fails when send2meId is missing for self / cloud', async () => {
      vi.mocked(zaloPool.getSend2MeId).mockReturnValue(undefined);
      mockApi.getContext.mockReturnValue({});

      const result = await sendReportToZalo({
        accountId,
        orgId,
        destinationType: 'self',
        markdownContent: 'Gửi về Cloud',
        executionGuard: vi.fn().mockResolvedValue(undefined),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Không thể xác định Cloud của tôi (send2me_id)');
    });

    it('resolves phone number via CRM contact and caches result', async () => {
      vi.mocked(prisma.contact.findFirst).mockResolvedValueOnce({
        id: 'contact-1',
        zaloUid: 'zalo-uid-from-crm',
      } as any);

      const result = await sendReportToZalo({
        accountId,
        orgId,
        destinationType: 'uid',
        targetUid: '0987654321',
        markdownContent: 'Báo cáo qua số điện thoại',
        executionGuard: vi.fn().mockResolvedValue(undefined),
      });

      expect(result.success).toBe(true);
      expect(mockApi.sendMessage).toHaveBeenCalledWith(
        { msg: 'Báo cáo qua số điện thoại' },
        'zalo-uid-from-crm',
        0,
      );
      expect(mockApi.findUser).not.toHaveBeenCalled();

      // Second call should hit the cache without calling prisma.contact.findFirst
      vi.mocked(prisma.contact.findFirst).mockClear();
      const result2 = await sendReportToZalo({
        accountId,
        orgId,
        destinationType: 'uid',
        targetUid: '0987654321',
        markdownContent: 'Báo cáo lần 2',
        executionGuard: vi.fn().mockResolvedValue(undefined),
      });
      expect(result2.success).toBe(true);
      expect(prisma.contact.findFirst).not.toHaveBeenCalled();
    });

    it('resolves phone number via api.findUser when not in CRM', async () => {
      vi.mocked(prisma.contact.findFirst).mockResolvedValueOnce(null); // not found with zaloUid
      mockApi.findUser.mockResolvedValueOnce({ uid: 'zalo-uid-from-api' });
      vi.mocked(prisma.contact.findFirst).mockResolvedValueOnce(null); // no contact without uid

      const result = await sendReportToZalo({
        accountId,
        orgId,
        destinationType: 'uid',
        targetUid: '+84 987 654 321',
        markdownContent: 'Báo cáo qua SĐT quốc tế',
        executionGuard: vi.fn().mockResolvedValue(undefined),
      });

      expect(result.success).toBe(true);
      expect(mockApi.sendMessage).toHaveBeenCalledWith(
        { msg: 'Báo cáo qua SĐT quốc tế' },
        'zalo-uid-from-api',
        0,
      );
    });

    it('updates existing contact zaloUid when found via api.findUser without creating new contact', async () => {
      vi.mocked(prisma.contact.findFirst).mockResolvedValueOnce(null); // no contact with zaloUid
      mockApi.findUser.mockResolvedValueOnce({ uid: 'zalo-uid-new' });
      vi.mocked(prisma.contact.findFirst).mockResolvedValueOnce({ id: 'existing-contact-id' } as any); // contact without zaloUid

      const result = await sendReportToZalo({
        accountId,
        orgId,
        destinationType: 'uid',
        targetUid: '0912345678',
        markdownContent: 'Báo cáo cập nhật',
        executionGuard: vi.fn().mockResolvedValue(undefined),
      });

      expect(result.success).toBe(true);
      expect(prisma.contact.update).toHaveBeenCalledWith({
        where: { id: 'existing-contact-id' },
        data: { zaloUid: 'zalo-uid-new' },
      });
    });

    it('fails with friendly error when phone number is not found or privacy blocked', async () => {
      vi.mocked(prisma.contact.findFirst).mockResolvedValueOnce(null);
      mockApi.findUser.mockResolvedValueOnce(undefined); // error 216 or not found

      const result = await sendReportToZalo({
        accountId,
        orgId,
        destinationType: 'uid',
        targetUid: '0988888888',
        markdownContent: 'Báo cáo thất bại',
        executionGuard: vi.fn().mockResolvedValue(undefined),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Không tìm thấy tài khoản Zalo liên kết với số điện thoại "0988888888"');
    });

    it('fails gracefully when targetThreadId is missing for group destination', async () => {
      const result = await sendReportToZalo({
        accountId,
        orgId,
        destinationType: 'group',
        markdownContent: 'Báo cáo',
        executionGuard: vi.fn().mockResolvedValue(undefined),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('report_destination_required');
    });

    it('handles Zalo API failure and captures error details with deliveryUncertain state', async () => {
      mockApi.sendMessage.mockRejectedValue(new Error('Mất kết nối mạng Zalo'));

      const result = await sendReportToZalo({
        accountId,
        orgId,
        destinationType: 'group',
        targetThreadId: 'group-thread-456',
        markdownContent: 'Nội dung',
        executionGuard: vi.fn().mockResolvedValue(undefined),
      });

      expect(result.success).toBe(false);
      expect(result.deliveryUncertain).toBe(true);
      expect(result.error).toBe('Mất kết nối mạng Zalo');
    });
  });
});
