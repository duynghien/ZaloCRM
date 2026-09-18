import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  splitReportForZalo,
  sendReportToZalo,
  sendMessageWithTimeout,
  ZALO_MESSAGE_TIMEOUT_MS,
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

    it('dispatches executive report in dual_pdf mode with brief message and PDF attachment', async () => {
      const executiveMarkdown = `# 📑 BÁO CÁO ĐIỀU HÀNH TỔNG HỢP — TỨC THÌ
*Thời gian: 17:00 16/09/2026 — 09:40 17/09/2026 | Số nhóm theo dõi: 1 (1 nhóm có hoạt động)*

---

## 🎯 1. TÓM TẮT 3 ĐIỂM CỐT LÕI (Core Highlights)
* Điểm 1: Hoạt động chuẩn bị đầy đủ.

## 📋 5. KẾ HOẠCH & HÀNH ĐỘNG TIẾP THEO (Next Steps & Assignments)
| # | Hành động | Người phụ trách | Thời hạn | Ưu tiên |
|---|---|---|---|---|
| 1 | Kiểm tra thiết bị | Quản lý | Cuối ca | 🔴 Cao |
`;

      const result = await sendReportToZalo({
        accountId,
        orgId,
        destinationType: 'uid',
        targetUid: 'user-uid-789',
        markdownContent: executiveMarkdown,
        reportTitle: 'Báo Cáo Điều Hành Tức Thì',
        deliveryMode: 'dual_pdf',
        executionGuard: vi.fn().mockResolvedValue(undefined),
      });

      expect(result.success).toBe(true);
      expect(result.partsSent).toBe(1);
      expect(mockApi.sendMessage).toHaveBeenCalledTimes(1);

      const [callArg, targetDest, targetThread] = mockApi.sendMessage.mock.calls[0];
      expect(targetDest).toBe('user-uid-789');
      expect(targetThread).toBe(0);
      expect(callArg.msg).toContain('📑 BÁO CÁO ĐIỀU HÀNH TỨC THÌ'); // explicit reportTitle wins (SSoT)
      expect(callArg.msg).toContain('🎯 3 ĐIỂM CỐT LÕI (CORE HIGHLIGHTS):');
      expect(callArg.msg).toContain('📎 Bản báo cáo chi tiết đầy đủ đính kèm trong file PDF bên dưới.');
      expect(callArg.attachments).toBeDefined();
      expect(callArg.attachments.length).toBe(1);
      expect(callArg.attachments[0]).toMatch(/\.pdf$/i);
    });

    it('dispatches clean plain text without attachments when deliveryMode is full_text', async () => {
      const executiveMarkdown = `# 📑 BÁO CÁO ĐIỀU HÀNH TỔNG HỢP
## 🎯 1. TÓM TẮT
* **Việc 1:** Làm xong.
`;

      const result = await sendReportToZalo({
        accountId,
        orgId,
        destinationType: 'group',
        targetThreadId: 'group-thread-456',
        markdownContent: executiveMarkdown,
        deliveryMode: 'full_text',
        executionGuard: vi.fn().mockResolvedValue(undefined),
      });

      expect(result.success).toBe(true);
      expect(mockApi.sendMessage).toHaveBeenCalledTimes(1);

      const [callArg] = mockApi.sendMessage.mock.calls[0];
      expect(callArg.attachments).toBeUndefined();
      expect(callArg.msg).toContain('📑 BÁO CÁO ĐIỀU HÀNH TỔNG HỢP');
      expect(callArg.msg).toContain('• Việc 1: Làm xong.');
      expect(callArg.msg).not.toContain('**');
    });

    it('handles Zalo sendMessage hang gracefully with timeout and deliveryUncertain', async () => {
      // Mock sendMessage to hang indefinitely
      mockApi.sendMessage.mockReturnValue(new Promise(() => {}));

      const result = await sendReportToZalo({
        accountId,
        orgId,
        destinationType: 'group',
        targetThreadId: 'group-thread-456',
        markdownContent: 'Báo cáo kiểm tra timeout',
        messageTimeoutMs: 50, // Short timeout for test
        executionGuard: vi.fn().mockResolvedValue(undefined),
      });

      expect(result.success).toBe(false);
      expect(result.deliveryUncertain).toBe(true);
      expect(result.error).toContain('Quá thời gian chờ Zalo phản hồi khi gửi tin');
    });
  });

  describe('sendMessageWithTimeout', () => {
    it('resolves immediately when underlying sendMessage succeeds', async () => {
      const api = { sendMessage: vi.fn().mockResolvedValue({ id: 'msg-123' }) };
      const res = await sendMessageWithTimeout(api, { msg: 'test' }, 'dest-1', 0, 1000);
      expect(res).toEqual({ id: 'msg-123' });
      expect(api.sendMessage).toHaveBeenCalledWith({ msg: 'test' }, 'dest-1', 0);
    });

    it('rejects when underlying sendMessage exceeds timeoutMs', async () => {
      const api = { sendMessage: vi.fn().mockReturnValue(new Promise(() => {})) };
      await expect(
        sendMessageWithTimeout(api, { msg: 'test' }, 'dest-1', 0, 30),
      ).rejects.toThrow('Quá thời gian chờ Zalo phản hồi khi gửi tin (0s)');
    });

    it('rejects immediately when AbortSignal is already aborted', async () => {
      const api = { sendMessage: vi.fn() };
      const controller = new AbortController();
      controller.abort();

      await expect(
        sendMessageWithTimeout(api, { msg: 'test' }, 'dest-1', 0, 1000, controller.signal),
      ).rejects.toThrow('Đã hủy gửi tin Zalo');
      expect(api.sendMessage).not.toHaveBeenCalled();
    });

    it('rejects when AbortSignal aborts while sendMessage is pending', async () => {
      const api = { sendMessage: vi.fn().mockReturnValue(new Promise(() => {})) };
      const controller = new AbortController();

      const promise = sendMessageWithTimeout(api, { msg: 'test' }, 'dest-1', 0, 5000, controller.signal);
      setTimeout(() => controller.abort(), 20);

      await expect(promise).rejects.toThrow('Đã hủy gửi tin Zalo');
    });
  });

  describe('Phase03: metadata propagation into generateExecutiveBrief (dual_pdf mode)', () => {
    it('brief message contains explicit reportTitle and periodText passed via options', async () => {
      // Create content that triggers dual_pdf mode (contains ## 🎯)
      const reportMarkdown = `# 📑 BÁO CÁO ĐIỀU HÀNH TỔNG HỢP — TỨC THÌ
*Thời gian: 10:00 17/09 — 18:00 17/09 | Số nhóm: 1*

---

## 🎯 1. TÓM TẮT 3 ĐIỂM CỐT LÕI (Core Highlights)
* Công việc hoàn thành đúng tiến độ.

## 📋 5. KẾ HOẠCH & HÀNH ĐỘNG TIẾP THEO (Next Steps & Assignments)
| # | Hành động | Người phụ trách | Thời hạn | Ưu tiên |
|---|---|---|---|---|
| 1 | Kiểm tra cuối ca | Trưởng ca | 18:00 | 🟡 Trung bình |
`;

      let capturedMessage: any = null;
      mockApi.sendMessage.mockImplementation(async (message: any) => {
        capturedMessage = message;
        return { messageId: 'msg-brief' };
      });

      const result = await sendReportToZalo({
        accountId,
        orgId,
        destinationType: 'group',
        targetThreadId: 'group-thread-meta',
        markdownContent: reportMarkdown,
        reportTitle: 'Báo Cáo Điều Hành Tức Thì CA CHIỀU',
        periodText: '17:00 17/09/2026 — 13:03 18/09/2026',
        scopeText: 'Chi nhánh Miền Nam',
        deliveryMode: 'dual_pdf',
        executionGuard: vi.fn().mockResolvedValue(undefined),
      });

      // Verify that the brief (first message part) contains the explicit metadata
      expect(result.success).toBe(true);
      expect(capturedMessage).not.toBeNull();
      const briefMsg: string = capturedMessage?.msg || capturedMessage?.attachments?.[0] || '';

      // The brief must contain the explicit reportTitle and periodText passed via options
      expect(briefMsg).toContain('BÁO CÁO ĐIỀU HÀNH TỨC THÌ CA CHIỀU');
      expect(briefMsg).toContain('17:00 17/09/2026 — 13:03 18/09/2026');
      expect(briefMsg).toContain('Chi nhánh Miền Nam');
    });
  });
});
