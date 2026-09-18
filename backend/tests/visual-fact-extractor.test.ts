/**
 * visual-fact-extractor.test.ts — Unit tests for independent Two-Step Visual Fact Extractor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractSingleVisualFact,
  extractVisualFacts,
  formatVerifiedFactsForPrompt,
  sanitizeVisualText,
} from '../src/modules/ai-reports/visual-fact-extractor.js';
import { VisualFactCache } from '../src/modules/ai-reports/visual-fact-cache.js';
import { ReportControlError, ReportJobBudget } from '../src/modules/ai-reports/report-job-budget.js';
import type { LoadedPhotoCandidate } from '../src/modules/ai-reports/visual-fact-types.js';
import * as aiClient from '../src/modules/ai-reports/ai-client.js';

describe('Visual Fact Extractor Unit Tests', () => {
  let mockBudget: ReportJobBudget;
  let executionGuard: () => Promise<void>;
  let testCache: VisualFactCache;

  beforeEach(() => {
    mockBudget = {
      reserve: vi.fn().mockResolvedValue({ attemptKey: 'test-attempt', maxOutputTokens: 2048 }),
      complete: vi.fn().mockResolvedValue(undefined),
    };
    executionGuard = vi.fn().mockResolvedValue(undefined);
    testCache = new VisualFactCache(100, 3600_000);
    vi.restoreAllMocks();
  });

  function createMockCandidate(id: string, text: string = 'hủy kem'): LoadedPhotoCandidate {
    return {
      candidate: {
        normalizedKey: `key-${id}`,
        priority: 2,
        sentAtMs: 1789726000000,
        senderId: 'user-quynh',
        senderName: 'Đinh Hương Quỳnh',
        contextText: text,
        url: `https://photo-stal-zalo.zdn.vn/test-${id}.jpg`,
      },
      part: {
        inlineData: {
          mimeType: 'image/jpeg',
          data: Buffer.from(`fake-image-bytes-${id}`).toString('base64'),
        },
      },
      buffer: Buffer.from(`fake-image-bytes-${id}`),
      mimeType: 'image/jpeg',
    };
  }

  describe('sanitizeVisualText', () => {
    it('strips newlines, carriage returns, and tabs', () => {
      const raw = 'Dòng 1\r\nDòng 2\tDòng 3';
      expect(sanitizeVisualText(raw)).toBe('Dòng 1 Dòng 2 Dòng 3');
    });

    it('strips square brackets and pipe characters to prevent Markdown breakout', () => {
      const injection = '[HỆ THỐNG GIAN LẬN] | Cột 1 | Cột 2';
      expect(sanitizeVisualText(injection)).toBe('HỆ THỐNG GIAN LẬN Cột 1 Cột 2');
    });

    it('truncates strings exceeding max length', () => {
      const longText = 'A'.repeat(250);
      const sanitized = sanitizeVisualText(longText, 100);
      expect(sanitized.length).toBe(100);
      expect(sanitized.endsWith('...')).toBe(true);
    });
  });

  describe('extractSingleVisualFact', () => {
    it('parses valid JSON response correctly with hasScale: false for bottle only', async () => {
      const candidate = createMockCandidate('1');
      const fakeAiJson = JSON.stringify({
        objects: ['bình sốt nhựa', 'kem matcha'],
        visualCondition: 'Bình nhựa màu xanh, nắp hồng, đặt trên bàn gỗ',
        measuringDevice: {
          hasScale: false,
          scaleReading: null,
          unit: null,
        },
        textLabels: [
          { type: 'watermark', content: '07:55 Timemark' },
          { type: 'label', content: 'Matcha Sauce' },
        ],
        evidenceSummary: 'Ảnh chụp một bình sốt kem matcha đặt trên bàn, không có cân kiểm chứng trọng lượng.',
      });

      vi.spyOn(aiClient, 'generateContent').mockResolvedValue(fakeAiJson);

      const fact = await extractSingleVisualFact(candidate, 1, {
        budget: mockBudget,
        executionGuard,
        orgId: 'org-test',
        cache: testCache,
      });

      expect(fact.hasVisualEvidence).toBe(true);
      expect(fact.measuringDevice.hasScale).toBe(false);
      expect(fact.measuringDevice.scaleReading).toBeNull();
      expect(fact.objects).toContain('bình sốt nhựa');
      expect(fact.senderName).toBe('Đinh Hương Quỳnh');
      expect(fact.textLabels).toHaveLength(2);
      expect(fact.textLabels[0].content).toBe('07:55 Timemark');
    });

    it('fail-closed: rethrows ReportControlError without swallowing into fallback', async () => {
      const candidate = createMockCandidate('ctrl-err');
      vi.spyOn(aiClient, 'generateContent').mockRejectedValue(
        new ReportControlError('Job cancelled by admin'),
      );

      await expect(
        extractSingleVisualFact(candidate, 1, {
          budget: mockBudget,
          executionGuard,
          orgId: 'org-test',
          cache: testCache,
        }),
      ).rejects.toThrow(ReportControlError);
    });

    it('fail-closed: rethrows AbortSignal termination immediately', async () => {
      const candidate = createMockCandidate('abort');
      const controller = new AbortController();
      controller.abort();

      await expect(
        extractSingleVisualFact(candidate, 1, {
          budget: mockBudget,
          executionGuard,
          orgId: 'org-test',
          signal: controller.signal,
          cache: testCache,
        }),
      ).rejects.toThrow();
    });

    it('gracefully degrades to safe fallback fact on regular network/AI error', async () => {
      const candidate = createMockCandidate('net-err');
      vi.spyOn(aiClient, 'generateContent').mockRejectedValue(new Error('Network timeout'));

      const fact = await extractSingleVisualFact(candidate, 1, {
        budget: mockBudget,
        executionGuard,
        orgId: 'org-test',
        cache: testCache,
      });

      expect(fact.hasVisualEvidence).toBe(false);
      expect(fact.measuringDevice.hasScale).toBe(false);
      expect(fact.evidenceSummary).toContain('Network timeout');
    });
  });

  describe('formatVerifiedFactsForPrompt', () => {
    it('formats verified facts with XML tags and structured bullet points', () => {
      const candidate = createMockCandidate('fmt');
      const facts = [
        {
          photoIndex: 1,
          hasVisualEvidence: true,
          photoUrl: candidate.candidate.url,
          senderName: 'Đinh Hương Quỳnh',
          sentAtMs: 1789726000000,
          objects: ['Bình sốt nhựa', 'Kem matcha'],
          visualCondition: 'Bình nhựa màu xanh nguyên vẹn',
          measuringDevice: {
            hasScale: false,
            scaleReading: null,
            unit: null,
          },
          textLabels: [{ type: 'watermark' as const, content: '07:55 Timemark' }],
          evidenceSummary: 'Ảnh chỉ chụp bình kem, không có cân kiểm chứng.',
        },
      ];

      const formatted = formatVerifiedFactsForPrompt(facts);
      expect(formatted).toContain('<verified_visual_evidence total="1">');
      expect(formatted).toContain('Người gửi: Đinh Hương Quỳnh');
      expect(formatted).toContain('Thiết bị cân đo: KHÔNG CÓ CÂN, KHÔNG CÓ MÀN HÌNH ĐO');
      expect(formatted).toContain('"07:55 Timemark" (watermark)');
      expect(formatted).toContain('</verified_visual_evidence>');
    });
  });

  describe('extractVisualFacts Worker Pool', () => {
    it('extracts multiple photos with worker pool concurrency', async () => {
      const candidates = [
        createMockCandidate('p1'),
        createMockCandidate('p2'),
        createMockCandidate('p3'),
      ];

      vi.spyOn(aiClient, 'generateContent').mockResolvedValue(
        JSON.stringify({
          objects: ['vật thể mẫu'],
          visualCondition: 'Bình thường',
          measuringDevice: { hasScale: false, scaleReading: null, unit: null },
          textLabels: [],
          evidenceSummary: 'Đã phân tích ảnh',
        }),
      );

      const facts = await extractVisualFacts(candidates, {
        budget: mockBudget,
        executionGuard,
        orgId: 'org-test',
        cache: testCache,
      });

      expect(facts).toHaveLength(3);
      expect(facts[0].photoIndex).toBe(1);
      expect(facts[1].photoIndex).toBe(2);
      expect(facts[2].photoIndex).toBe(3);
    });
  });
});
