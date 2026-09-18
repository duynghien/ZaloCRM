import { describe, expect, it } from 'vitest';
import { formatMarkdownForZalo, splitReportBySections } from '../src/modules/ai-reports/zalo-text-formatter.js';

describe('Zalo Text Formatter', () => {
  const sampleMarkdown = `# 📑 BÁO CÁO ĐIỀU HÀNH TỔNG HỢP — TỨC THÌ
*Thời gian: 17:00 16/09/2026 — 09:40 17/09/2026 | Số nhóm theo dõi: 1 (1 nhóm có hoạt động)*

---

## 🎯 1. TÓM TẮT 3 ĐIỂM CỐT LÕI (Core Highlights)
* **Sẵn sàng vận hành cơ bản:** Các công việc chuẩn bị đầu ca đã hoàn thành.
* **Rủi ro về tính minh bạch:** Phát hiện nhiều điểm bất thường.

## ✅ 2. CÔNG VIỆC ĐÃ HOÀN THÀNH (Completed Actions)
* Homey Đại Phúc (Người phụ trách: Quỳnh):
  * **Ca sáng:**
    * Kiểm tra hoa quả.

## 📋 5. KẾ HOẠCH & HÀNH ĐỘNG TIẾP THEO (Next Steps & Assignments)
| # | Hành động | Người phụ trách | Thời hạn | Ưu tiên |
|---|---|---|---|---|
| 1 | Nấu trân châu | Hải Anh | Ca chiều | 🔴 Cao |
| 2 | Sửa máy lạnh | Kỹ thuật | Ngày mai | 🟢 Thấp |
`;

  it('converts full markdown to clean Zalo typography without raw markdown artifacts', () => {
    const formatted = formatMarkdownForZalo(sampleMarkdown);

    expect(formatted).toContain('📑 BÁO CÁO ĐIỀU HÀNH TỔNG HỢP — TỨC THÌ');
    expect(formatted).toContain('⏰ Thời gian: 17:00 16/09/2026 — 09:40 17/09/2026');
    expect(formatted).toContain('🎯 1. TÓM TẮT 3 ĐIỂM CỐT LÕI');
    expect(formatted).toContain('• Sẵn sàng vận hành cơ bản: Các công việc chuẩn bị đầu ca đã hoàn thành.');
    expect(formatted).toContain('📋 5. KẾ HOẠCH & HÀNH ĐỘNG TIẾP THEO (ACTION ITEMS)');
    expect(formatted).toContain('🔴 Ưu tiên cao:');
    expect(formatted).toContain('1. Nấu trân châu');
    expect(formatted).toContain('👉 Phụ trách: Hải Anh | Hạn: Ca chiều');
    expect(formatted).toContain('🟢 Ưu tiên thấp:');
    expect(formatted).toContain('2. Sửa máy lạnh');

    // No raw markdown artifacts
    expect(formatted).not.toContain('**');
    expect(formatted).not.toContain('##');
    expect(formatted).not.toContain('|---|');
    expect(formatted).not.toContain('| 1 |');
  });

  it('splits long content by sections without breaking mid-sentence', () => {
    const section1 = '🎯 1. TÓM TẮT ĐIỂM CỐT LÕI\n' + 'Nội dung điểm cốt lõi chi tiết.\n'.repeat(5);
    const section2 = '✅ 2. CÔNG VIỆC HOÀN THÀNH\n' + 'Nội dung công việc hoàn thành.\n'.repeat(5);
    const fullText = section1 + '\n\n' + section2;

    const parts = splitReportBySections(fullText, 250);
    expect(parts.length).toBe(2);
    expect(parts[0]).toContain('PHẦN 1/2');
    expect(parts[0]).toContain('🎯 1. TÓM TẮT ĐIỂM CỐT LÕI');
    expect(parts[1]).toContain('PHẦN 2/2');
    expect(parts[1]).toContain('✅ 2. CÔNG VIỆC HOÀN THÀNH');
  });
});
