/**
 * summarizer-service-fallback.test.ts
 * Pure unit tests for buildStructuredFallbackReport — zero DB, zero network, <5ms per test.
 */
import { describe, expect, it } from 'vitest';
import { buildStructuredFallbackReport, type GroupDigestItem } from '../src/modules/ai-reports/summarizer-service.js';
import { parseActionItemsFromMarkdown } from '../src/modules/ai-reports/report-action-item-parser.js';

const periodFrom = new Date('2026-09-17T10:00:00+07:00');
const periodTo = new Date('2026-09-18T13:03:00+07:00');

function makeGroup(overrides: Partial<GroupDigestItem> = {}): GroupDigestItem {
  return {
    conversationId: 'conv-1',
    zaloAccountId: 'acc-1',
    groupThreadId: 'thread-1',
    groupName: 'Nhóm Kinh Doanh',
    messageCount: 10,
    filteredCount: 5,
    summary: 'Hoàn thành đơn hàng 500 đơn tuần này.',
    ...overrides,
  };
}

describe('buildStructuredFallbackReport — pure unit', () => {
  it('returns all 5 required sections with active groups', () => {
    const result = buildStructuredFallbackReport(
      [makeGroup()],
      periodFrom,
      periodTo,
      'on_demand',
    );

    expect(result).toContain('## 🎯 1. TÓM TẮT 3 ĐIỂM CỐT LÕI');
    expect(result).toContain('## ✅ 2. CÔNG VIỆC ĐÃ HOÀN THÀNH');
    expect(result).toContain('## ⚠️ 3. TỒN ĐỌNG, SỰ CỐ & RỦI RO PHÁT SINH');
    expect(result).toContain('## 📊 4. SỐ LIỆU, CHỈ SỐ & KPI CHÍNH');
    expect(result).toContain('## 📋 5. KẾ HOẠCH & HÀNH ĐỘNG TIẾP THEO');
  });

  it('returns all 5 sections even when 0 groups have activity', () => {
    const emptyGroups: GroupDigestItem[] = [
      makeGroup({ filteredCount: 0, messageCount: 0, summary: '' }),
    ];
    const result = buildStructuredFallbackReport(emptyGroups, periodFrom, periodTo, 'daily');

    expect(result).toContain('## 🎯 1. TÓM TẮT 3 ĐIỂM CỐT LÕI');
    expect(result).toContain('## ✅ 2. CÔNG VIỆC ĐÃ HOÀN THÀNH');
    expect(result).toContain('## ⚠️ 3. TỒN ĐỌNG, SỰ CỐ & RỦI RO PHÁT SINH');
    expect(result).toContain('## 📊 4. SỐ LIỆU, CHỈ SỐ & KPI CHÍNH');
    expect(result).toContain('## 📋 5. KẾ HOẠCH & HÀNH ĐỘNG TIẾP THEO');
    // Should contain default operational-normal bullet
    expect(result).toContain('Hệ thống vận hành ổn định');
  });

  it('Section 5 table rows contain group name prefix for cross-group isolation', () => {
    const groups = [
      makeGroup({ groupName: 'Nhóm A', filteredCount: 3, messageCount: 5 }),
      makeGroup({ groupName: 'Nhóm B', filteredCount: 2, messageCount: 4, groupThreadId: 'thread-2', conversationId: 'conv-2' }),
    ];
    const result = buildStructuredFallbackReport(groups, periodFrom, periodTo, 'weekly');

    expect(result).toContain('[Nhóm A]');
    expect(result).toContain('[Nhóm B]');
  });

  it('safe technical footnote is present and does not expose raw error/stack/API key', () => {
    const result = buildStructuredFallbackReport([makeGroup()], periodFrom, periodTo, 'on_demand', {
      failureReason: 'API_KEY=secret-key-12345 at summarizer-service.ts:294', // simulate raw error leak
      isTechnicalFallback: true,
    });

    expect(result).toContain('*Ghi chú: Báo cáo được tự động tổng hợp theo quy trình dự phòng kỹ thuật');
    // Must NOT expose the raw failureReason string
    expect(result).not.toContain('API_KEY=secret-key-12345');
    expect(result).not.toContain('summarizer-service.ts:294');
  });

  it('footnote line is NOT parsed as a CRM action item by parseActionItemsFromMarkdown', () => {
    const result = buildStructuredFallbackReport([makeGroup()], periodFrom, periodTo, 'on_demand');
    const actionItems = parseActionItemsFromMarkdown(result);

    // No action item should contain the footnote text
    const footnoteItems = actionItems.filter((item) =>
      item.task.includes('Ghi chú') || item.task.includes('dự phòng kỹ thuật'),
    );
    expect(footnoteItems).toHaveLength(0);
  });

  it('is deterministic — same inputs produce identical output', () => {
    const groups = [makeGroup()];
    const r1 = buildStructuredFallbackReport(groups, periodFrom, periodTo, 'daily');
    const r2 = buildStructuredFallbackReport(groups, periodFrom, periodTo, 'daily');
    expect(r1).toBe(r2);
  });

  it('runs in under 5ms (performance guard)', () => {
    const groups = Array.from({ length: 10 }, (_, i) =>
      makeGroup({ groupName: `Nhóm ${i}`, groupThreadId: `thread-${i}`, conversationId: `conv-${i}` }),
    );
    const start = performance.now();
    buildStructuredFallbackReport(groups, periodFrom, periodTo, 'on_demand');
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5);
  });

  it('output is compatible with parseActionItemsFromMarkdown — no parse crash', () => {
    const result = buildStructuredFallbackReport([makeGroup()], periodFrom, periodTo, 'on_demand');
    // Must not throw
    expect(() => parseActionItemsFromMarkdown(result)).not.toThrow();
  });
});
