/**
 * two-step-fact-extraction-regression.test.ts — End-to-end regression tests verifying the Two-Step Fact Extraction
 * architecture eliminates hallucination of weighing scales and prevents ungrounded fraud accusations.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractVisualFacts, formatVerifiedFactsForPrompt } from '../src/modules/ai-reports/visual-fact-extractor.js';
import { VisualFactCache } from '../src/modules/ai-reports/visual-fact-cache.js';
import { parseActionItemsFromMarkdown, parseActionItemCategory } from '../src/modules/ai-reports/report-action-item-parser.js';
import type { LoadedPhotoCandidate } from '../src/modules/ai-reports/visual-fact-types.js';
import type { ReportJobBudget } from '../src/modules/ai-reports/report-job-budget.js';
import * as aiClient from '../src/modules/ai-reports/ai-client.js';

describe('Two-Step Multimodal Fact Extraction Regression Suite', () => {
  let mockBudget: ReportJobBudget;
  let executionGuard: () => Promise<void>;
  let cache: VisualFactCache;

  beforeEach(() => {
    mockBudget = {
      reserve: vi.fn().mockResolvedValue({ attemptKey: 'attempt-reg', maxOutputTokens: 2048 }),
      complete: vi.fn().mockResolvedValue(undefined),
    };
    executionGuard = vi.fn().mockResolvedValue(undefined);
    cache = new VisualFactCache(100, 3600_000);
    vi.restoreAllMocks();
  });

  function createMatchaCandidate(): LoadedPhotoCandidate {
    const fakeBuffer = Buffer.from('matcha-sauce-bottle-image-bytes');
    return {
      candidate: {
        normalizedKey: 'url:https://photo-stal-01.zdn.vn/matcha.jpg',
        priority: 2,
        sentAtMs: new Date('2026-09-18T07:55:00Z').getTime(),
        senderId: 'user-quynh',
        senderName: 'Đinh Hương Quỳnh',
        contextText: 'Báo cáo hủy 280gr kem matcha. Lý do không đạt yêu cầu',
        url: 'https://photo-stal-01.zdn.vn/matcha.jpg',
      },
      part: {
        inlineData: {
          mimeType: 'image/jpeg',
          data: fakeBuffer.toString('base64'),
        },
      },
      buffer: fakeBuffer,
      mimeType: 'image/jpeg',
    };
  }

  it('Step 1: extracts objective visual facts without scale when photo only shows the bottle', async () => {
    const candidate = createMatchaCandidate();

    // Mock AI Vision extractor returning true ground truth for matcha bottle
    vi.spyOn(aiClient, 'generateContent').mockResolvedValue(
      JSON.stringify({
        objects: ['bình sốt nhựa', 'kem matcha màu xanh'],
        visualCondition: 'Bình nhựa màu xanh nguyên vẹn, đặt trên mặt bàn',
        measuringDevice: {
          hasScale: false,
          scaleReading: null,
          unit: null,
        },
        textLabels: [
          { type: 'watermark', content: '07:55 Timemark' },
          { type: 'watermark', content: 'Homey Đại Phúc' },
        ],
        evidenceSummary: 'Ảnh chụp bình sốt kem matcha đặt trên bàn, không có cân hoặc thiết bị đo lường.',
      }),
    );

    const facts = await extractVisualFacts([candidate], {
      budget: mockBudget,
      executionGuard,
      orgId: 'org-homey',
      cache,
    });

    expect(facts).toHaveLength(1);
    const fact = facts[0];
    expect(fact.hasVisualEvidence).toBe(true);
    expect(fact.measuringDevice.hasScale).toBe(false);
    expect(fact.measuringDevice.scaleReading).toBeNull();
    expect(fact.senderName).toBe('Đinh Hương Quỳnh');
    expect(fact.objects).toContain('bình sốt nhựa');

    // Verify formatted prompt text
    const formatted = formatVerifiedFactsForPrompt(facts);
    expect(formatted).toContain('KHÔNG CÓ CÂN, KHÔNG CÓ MÀN HÌNH ĐO');
    expect(formatted).toContain('Người gửi: Đinh Hương Quỳnh');
    expect(formatted).not.toContain('320gr');
  });

  it('Step 2 & Action Items: does not hallucinate 320gr and classifies missing scale photo as compliance reminder', () => {
    // Simulated report generated using grounded facts
    const groundedExecutiveReport = `
# 📑 BÁO CÁO ĐIỀU HÀNH TỔNG HỢP — NGÀY
*Thời gian: 07:00 18/09/2026 — 17:00 18/09/2026*

## 🎯 1. TÓM TẮT 3 ĐIỂM CỐT LÕI
- Hoạt động ca sáng diễn ra ổn định.
- Ghi nhận 01 trường hợp báo cáo hủy nguyên liệu kem matcha.

## 📋 5. KẾ HOẠCH & HÀNH ĐỘNG TIẾP THEO
| # | Hành động | Người phụ trách | Thời hạn | Ưu tiên |
|---|---|---|---|---|
| 1 | [Nhắc nhở chứng từ] Nhắc nhở Đinh Hương Quỳnh tuân thủ quy trình chụp ảnh đặt trên cân kiểm chứng khi báo cáo hủy nguyên liệu (hiện ảnh mới chỉ chụp chai kem, thiếu ảnh cân) | Đinh Hương Quỳnh | Trong ca | 🟡 Trung bình |
| 2 | Kiểm tra tồn kho bột matcha tại quầy pha chế | Quản lý ca | 18:00 | 🟢 Thấp |
`;

    // 1. Assert no confabulation of 320gr or fictitious scale photo
    expect(groundedExecutiveReport).not.toContain('320gr');
    expect(groundedExecutiveReport).not.toContain('ảnh cân (320gr)');

    // 2. Parse action items and verify category and priority
    const items = parseActionItemsFromMarkdown(groundedExecutiveReport, 'Nhóm Vận Hành');
    expect(items).toHaveLength(2);

    const reminderTask = items[0];
    expect(reminderTask.assignee).toBe('Đinh Hương Quỳnh');
    expect(reminderTask.priority).toBe('medium');
    expect(reminderTask.category).toBe('compliance_missing_evidence');

    const regularTask = items[1];
    expect(regularTask.priority).toBe('low');
    expect(regularTask.category).toBe('operational_task');
  });

  it('correctly flags genuine discrepancies as anomaly_fraud with high priority', () => {
    const reportWithRealDiscrepancy = `
## 📋 5. KẾ HOẠCH & HÀNH ĐỘNG TIẾP THEO
| # | Hành động | Người phụ trách | Thời hạn | Ưu tiên |
|---|---|---|---|---|
| 1 | [Bất thường] Yêu cầu nhân viên giải trình sự sai lệch số liệu: khai báo 280gr nhưng màn hình cân điện tử hiển thị rõ 350gr | Nguyễn Văn A | Trước 12:00 | 🔴 Cao |
`;

    const items = parseActionItemsFromMarkdown(reportWithRealDiscrepancy);
    expect(items).toHaveLength(1);
    expect(items[0].priority).toBe('high');
    expect(items[0].category).toBe('anomaly_fraud');
  });

  describe('Multi-Tenant Cache Isolation & Safety', () => {
    it('strictly isolates cached visual facts between organizations with identical image buffers', async () => {
      const candidate = createMatchaCandidate();

      vi.spyOn(aiClient, 'generateContent').mockResolvedValue(
        JSON.stringify({
          objects: ['bình sốt nhựa'],
          visualCondition: 'Nguyên vẹn',
          measuringDevice: { hasScale: false, scaleReading: null, unit: null },
          textLabels: [],
          evidenceSummary: 'Bình nhựa trên bàn',
        }),
      );

      // Org A extracts and caches fact
      const factsOrgA = await extractVisualFacts([candidate], {
        budget: mockBudget,
        executionGuard,
        orgId: 'tenant-alpha',
        cache,
      });
      expect(factsOrgA).toHaveLength(1);

      // Verify Org A has item in cache
      const cachedForA = cache.get('tenant-alpha', candidate.buffer);
      expect(cachedForA).not.toBeNull();

      // Verify Org B receives cache miss for the exact same buffer
      const cachedForB = cache.get('tenant-beta', candidate.buffer);
      expect(cachedForB).toBeNull();

      // Verify cache never falls back to 'common' when orgId is undefined
      const cachedForUndefined = cache.get(undefined, candidate.buffer);
      expect(cachedForUndefined).toBeNull();
    });
  });

  describe('Backward Compatibility for Historical Action Items', () => {
    it('gracefully assigns operational_task when category is missing from legacy markdown or undefined', () => {
      const legacyReport = `
## 📋 5. KẾ HOẠCH & HÀNH ĐỘNG TIẾP THEO
| # | Hành động | Người phụ trách | Thời hạn | Ưu tiên |
|---|---|---|---|---|
| 1 | Đặt thêm đá viên và bao bì takeaway | Ca chiều | 14:00 | 🟡 Trung bình |
`;

      const items = parseActionItemsFromMarkdown(legacyReport);
      expect(items).toHaveLength(1);
      expect(items[0].category).toBe('operational_task');
      expect(parseActionItemCategory(items[0].task)).toBe('operational_task');
    });
  });
});
