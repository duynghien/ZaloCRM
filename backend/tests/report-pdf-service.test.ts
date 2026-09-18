import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { generateReportPdfBuffer, generateReportPdfFile } from '../src/modules/ai-reports/report-pdf-service.js';

describe('Report PDF Service', () => {
  const sampleMarkdown = `# 📑 BÁO CÁO ĐIỀU HÀNH TỔNG HỢP — TỨC THÌ
*Thời gian: 17:00 16/09/2026 — 09:40 17/09/2026 | Số nhóm theo dõi: 1 (1 nhóm có hoạt động)*

---

## 🎯 1. TÓM TẮT 3 ĐIỂM CỐT LÕI (Core Highlights)
* **Sẵn sàng vận hành cơ bản:** Các công việc chuẩn bị đầu ca sáng và ca chiều tại Homey Đại Phúc đã hoàn thành.
* **Rủi ro về tính minh bạch và kiểm soát:** Cần rà soát đối chiếu ảnh chụp và văn bản.
* **Thiếu sót trong báo cáo:** Trân châu Oolong chưa cập nhật kết quả.

## ✅ 2. CÔNG VIỆC ĐÃ HOÀN THÀNH (Completed Actions)
* Homey Đại Phúc:
  * Kiểm tra hoa quả, test máy.

## ⚠️ 3. TỒN ĐỌNG, SỰ CỐ & RỦI RO PHÁT SINH (Blockers & Risks)
* Trân châu Oolong: Báo cáo đang nấu lúc 01:04 nhưng không có cập nhật hoàn thành.

## 📊 4. SỐ LIỆU, CHỈ SỐ & KPI CHÍNH (Key Metrics)
* Doanh thu ca: 12.500.000 VNĐ

## 📋 5. KẾ HOẠCH & HÀNH ĐỘNG TIẾP THEO (Next Steps & Assignments)
| # | Hành động | Người phụ trách | Thời hạn | Ưu tiên |
|---|---|---|---|---|
| 1 | Yêu cầu làm rõ mục đích ảnh dưa hấu 9.5kg | Trưởng ca | 17/09 (cuối ca) | 🔴 Cao |
| 2 | Cung cấp lý do hủy shot cà phê test máy | Trưởng ca | 17/09 (cuối ca) | 🔴 Cao |
| 3 | Kiểm tra định kỳ máy lạnh | Kỹ thuật | 18/09 | 🟢 Thấp |
`;

  it('generates a valid PDF buffer with PDF magic header', async () => {
    const buffer = await generateReportPdfBuffer('Báo Cáo Điều Hành Tức Thì', sampleMarkdown);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);

    // Standard PDF file starts with %PDF-
    const header = buffer.subarray(0, 5).toString('ascii');
    expect(header).toBe('%PDF-');
  });

  it('generates a temporary PDF file and cleans it up properly', async () => {
    const { filePath, filename, cleanup } = await generateReportPdfFile('Báo Cáo Điều Hành Tức Thì', sampleMarkdown);

    expect(fs.existsSync(filePath)).toBe(true);
    expect(filename).toMatch(/\.pdf$/i);
    expect(filename).toContain('bao-cao-dieu-hanh');

    const stat = await fs.promises.stat(filePath);
    expect(stat.size).toBeGreaterThan(1000);

    // Test cleanup
    await cleanup();
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('generates the exact expected page count without ghost pages from footer overflow', async () => {
    const buffer = await generateReportPdfBuffer('Báo Cáo Điều Hành Tức Thì', sampleMarkdown);
    const pdfString = buffer.toString('latin1');
    const pages = pdfString.match(/\/Type\s*\/Page\b/g);
    // Standard short sample should be exactly 1 page, not 3
    expect(pages?.length).toBe(1);
  });

  it('renders unnumbered and custom sections without dropping content', async () => {
    const unnumbered = `# 📑 BÁO CÁO ĐIỀU HÀNH TỔNG HỢP — TỨC THÌ
**Thời gian:** 00:00 — 06:00 18/09/2026 | Toàn hệ thống

Trong khoảng thời gian theo dõi từ 00:00 đến 06:00, toàn bộ các nhóm không ghi nhận tin nhắn hoặc hoạt động phát sinh mới.

## 🎯 Điểm nổi bật
- Hệ thống hoạt động bình thường, không có sự cố kỹ thuật.
- Không có khiếu nại khách hàng ngoài giờ làm việc.
`;
    const buffer = await generateReportPdfBuffer('Báo Cáo Điều Hành Tức Thì (18/9/2026)', unnumbered);
    const pdfString = buffer.toString('latin1');
    const pages = pdfString.match(/\/Type\s*\/Page\b/g);
    expect(pages?.length).toBe(1);
    expect(buffer.length).toBeGreaterThan(1000);
  });
});
