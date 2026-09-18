import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import zlib from 'node:zlib';
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

  // Helper to count occurrences of table header rectangles (#1E293B, height 22) in decompressed PDF streams
  const countActionTableHeaders = (pdfBuffer: Buffer): number => {
    const str = pdfBuffer.toString('binary');
    const regex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let match: RegExpExecArray | null;
    let count = 0;
    while ((match = regex.exec(str)) !== null) {
      const raw = Buffer.from(match[1], 'binary');
      try {
        const decompressed = zlib.inflateSync(raw).toString('utf-8');
        if (
          decompressed.includes('523.28 22 re') &&
          decompressed.includes('0.11764705882352941 0.1607843137254902 0.23137254901960785 scn')
        ) {
          const matches = decompressed.match(/0\.11764705882352941 0\.1607843137254902 0\.23137254901960785 scn/g);
          if (matches) count += matches.length;
        }
      } catch {
        // stream was not flate compressed or failed to inflate
      }
    }
    return count;
  };

  it('renders 8-item executive action items table with dynamic wrapping and compact height', async () => {
    const markdownWith8Tasks = `# 📑 BÁO CÁO ĐIỀU HÀNH TỔNG HỢP — TỨC THÌ
*Thời gian: 17:00 16/09/2026 — 09:40 17/09/2026 | Số nhóm theo dõi: 1 (1 nhóm có hoạt động)*

---

## 🎯 1. TÓM TẮT 3 ĐIỂM CỐT LÕI (Core Highlights)
* **Sẵn sàng vận hành cơ bản:** Các công việc chuẩn bị đầu ca sáng và ca chiều tại Homey Đại Phúc đã hoàn thành.
* **Rủi ro về tính minh bạch và kiểm soát:** Cần rà soát đối chiếu ảnh chụp và văn bản.
* **Thiếu sót trong báo cáo:** Trân châu Oolong chưa cập nhật kết quả.

## ✅ 2. CÔNG VIỆC ĐÃ HOÀN THÀNH (Completed Actions)
* Homey Đại Phúc: Kiểm tra hoa quả, test máy pha cà phê lúc đầu ca.

## ⚠️ 3. TỒN ĐỌNG, SỰ CỐ & RỦI RO PHÁT SINH (Blockers & Risks)
* Trân châu Oolong: Báo cáo đang nấu lúc 01:04 nhưng không có cập nhật hoàn thành.

## 📊 4. SỐ LIỆU, CHỈ SỐ & KPI CHÍNH (Key Metrics)
* Doanh thu ca: 12.500.000 VNĐ

## 📋 5. KẾ HOẠCH & HÀNH ĐỘNG TIẾP THEO (Next Steps & Assignments)
| # | Hành động | Người phụ trách | Thời hạn | Ưu tiên |
|---|---|---|---|---|
| 1 | [Bất thường] Xác minh báo cáo "mở 1 hạt nổ" (07:19) nhưng ảnh chụp đính kèm thể hiện 3 bịch hạt nổ; làm rõ nguyên nhân lệch số liệu giữa ảnh chụp và văn bản với bạn Nguyễn Thùy Trang. | Trưởng ca | 17/09 (cuối ca) | 🔴 Cao |
| 2 | Đánh giá thiệt hại ghế bị gãy do khách hàng và lên kế hoạch sửa chữa/thay thế; nhắc nhở nhân viên lưu ý quan sát để đảm bảo an toàn cho khách hàng khác. | Quản lý / Kỹ thuật | 17/09 | 🟡 T.Bình |
| 3 | Đảm bảo ca sáng (Dương Minh Thảo Nguyên, Hg Tiến Cường) cần quét dọn sân cửa trước, dắt xe cho khách ngay khi có khách tới và dọn dẹp nhà vệ sinh sạch sẽ trước giờ mở cửa. | Trưởng ca | 17/09 (10:00) | 🔴 Cao |
| 4 | Cung cấp lý do hủy shot cà phê test máy lúc 06:20 (nguyên nhân do lỗi kỹ thuật máy hay barista căn chỉnh chưa chuẩn). | Barista ca sáng | 17/09 | 🟡 T.Bình |
| 5 | Kiểm tra lại tình trạng tồn và báo cáo hoàn thành việc nấu trân châu Oolong (đang nấu lúc 01:04 nhưng chưa có báo cáo chốt ca đêm). | Trưởng ca | 17/09 (12:00) | 🔴 Cao |
| 6 | Bổ sung đầy đủ hóa đơn, chứng từ chi tiêu nguyên vật liệu phát sinh ngoài ca cho kế toán kiểm tra trước 15:00. | Kế toán ca | 17/09 | 🟢 Thấp |
| 7 | Hoàn tất kiểm kê kho lạnh định kỳ giữa tuần và đối chiếu sai lệch nguyên vật liệu hộp sữa đặc. | Thủ kho | 18/09 | 🟡 T.Bình |
| 8 | Tổ chức họp bàn giao ca và rút kinh nghiệm về các lỗi phát sinh trong quy trình kiểm soát đồ ăn kèm của nhân viên mới. | Toàn bộ nhân viên ca | 18/09 | 🟢 Thấp |
`;

    const buffer = await generateReportPdfBuffer('Báo Cáo Điều Hành Tức Thì', markdownWith8Tasks);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(5000);

    const pdfString = buffer.toString('latin1');
    const pages = pdfString.match(/\/Type\s*\/Page\b/g);
    // With compact dynamic wrapping, all 8 items fit within 1 or at most 2 pages
    expect(pages?.length).toBeGreaterThanOrEqual(1);
    expect(pages?.length).toBeLessThanOrEqual(2);

    const headerCount = countActionTableHeaders(buffer);
    expect(headerCount).toBe(pages?.length);
  });

  it('repeats table header cleanly on page breaks when table spans multiple pages without ghost pages', async () => {
    // Generate a long table with 20 items to guarantee multi-page table spanning
    const rows = Array.from({ length: 20 }, (_, i) => {
      return `| ${i + 1} | Nhiệm vụ chi tiết số ${i + 1}: Kiểm tra và đối chiếu các khoản thu chi, xác minh biên lai thanh toán và rà soát các vấn đề vận hành ca làm việc | Trưởng ca ${i + 1} | 18/09 (17:00) | ${i % 2 === 0 ? '🔴 Cao' : '🟡 T.Bình'} |`;
    }).join('\n');

    const multiPageMarkdown = `# 📑 BÁO CÁO ĐIỀU HÀNH TỔNG HỢP
*Thời gian: 17/09/2026 — 18/09/2026 | Toàn hệ thống*

---

## 📋 5. KẾ HOẠCH & HÀNH ĐỘNG TIẾP THEO (Next Steps & Assignments)
| # | Hành động | Người phụ trách | Thời hạn | Ưu tiên |
|---|---|---|---|---|
${rows}
`;

    const buffer = await generateReportPdfBuffer('Báo Cáo Nhiều Trang', multiPageMarkdown);
    const pdfString = buffer.toString('latin1');
    const pages = pdfString.match(/\/Type\s*\/Page\b/g);

    expect(pages?.length).toBeGreaterThanOrEqual(2);
    const headerCount = countActionTableHeaders(buffer);
    // Table header must appear on each page that contains table content
    expect(headerCount).toBe(pages?.length);
  });

  it('prevents orphan header when preceding content ends near bottom boundary', async () => {
    // Create paragraphs that fill almost the entire first page so doc.y is near bottom (> 750pt)
    const fillerParagraphs = Array.from({ length: 25 }, (_, i) => `Đoạn văn kiểm tra ngưỡng biên trang số ${i + 1}: Hệ thống ghi nhận thông tin vận hành đầy đủ và chính xác không có gián đoạn dịch vụ.`).join('\n\n');

    const orphanBoundaryMarkdown = `# 📑 BÁO CÁO ĐIỀU HÀNH TỔNG HỢP
*Thời gian: 17/09/2026 | Toàn hệ thống*

---

## 🎯 1. CÁC NỘI DUNG VẬN HÀNH
${fillerParagraphs}

## 📋 5. KẾ HOẠCH & HÀNH ĐỘNG TIẾP THEO
| # | Hành động | Người phụ trách | Thời hạn | Ưu tiên |
|---|---|---|---|---|
| 1 | Hành động đầu tiên sau khi sang trang an toàn không bị mồ côi header | Quản lý | 18/09 | 🔴 Cao |
`;

    const buffer = await generateReportPdfBuffer('Báo Cáo Chống Mồ Côi Header', orphanBoundaryMarkdown);
    const pdfString = buffer.toString('latin1');
    const pages = pdfString.match(/\/Type\s*\/Page\b/g);

    expect(pages?.length).toBeGreaterThanOrEqual(2);
    // Header should be rendered on page 2 alongside row 1 rather than orphaned on page 1
    const headerCount = countActionTableHeaders(buffer);
    expect(headerCount).toBe(1);
  });

  it('safely clamps single-row extreme content at MAX_ROW_H without looping or crashing', async () => {
    const extremeLongTask = 'Mô tả công việc cực đoan '.repeat(600); // > 1500 words, ~100+ lines
    const attackMarkdown = `# 📑 BÁO CÁO ĐIỀU HÀNH TỔNG HỢP
*Thời gian: 17/09/2026 | Toàn hệ thống*

---

## 📋 5. KẾ HOẠCH & HÀNH ĐỘNG TIẾP THEO
| # | Hành động | Người phụ trách | Thời hạn | Ưu tiên |
|---|---|---|---|---|
| 1 | ${extremeLongTask} | Trưởng ca | 18/09 | 🔴 Cao |
| 2 | Công việc bình thường tiếp theo ngay sau công việc cực đoan | Nhân viên | 18/09 | 🟢 Thấp |
`;

    const buffer = await generateReportPdfBuffer('Báo Cáo Giới Hạn Hàng', attackMarkdown);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);

    const pdfString = buffer.toString('latin1');
    const pages = pdfString.match(/\/Type\s*\/Page\b/g);
    // Clamping ensures no infinite page loops
    expect(pages?.length).toBeLessThan(5);
  });

  it('safely handles pipe delimiter injection and escaped pipes without shifting columns', async () => {
    const pipeInjectionMarkdown = `# 📑 BÁO CÁO ĐIỀU HÀNH TỔNG HỢP
*Thời gian: 17/09/2026 | Toàn hệ thống*

---

## 📋 5. KẾ HOẠCH & HÀNH ĐỘNG TIẾP THEO
| # | Hành động | Người phụ trách | Thời hạn | Ưu tiên |
|---|---|---|---|---|
| 1 | Xác minh đơn #123 | Đã kiểm kho vật tư | Trưởng ca | 17/09 | 🔴 Cao |
| 2 | Kiểm tra quầy pha chế \\| tồn kho siro hương liệu | Barista | 17/09 | 🟡 T.Bình |
`;

    const buffer = await generateReportPdfBuffer('Báo Cáo Pipe Injection', pipeInjectionMarkdown);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it('safely strips control characters without crashing PDFKit stream', async () => {
    const controlCharsMarkdown = `# 📑 BÁO CÁO ĐIỀU HÀNH TỔNG HỢP\x00
*Thời gian: 17/09/2026\x08 | Toàn hệ thống\x0C*

---

## 📋 5. KẾ HOẠCH & HÀNH ĐỘNG TIẾP THEO
| # | Hành động | Người phụ trách | Thời hạn | Ưu tiên |
|---|---|---|---|---|
| 1 | Kiểm tra ký tự lạ \x01\x02\x1F trong báo cáo | Kỹ thuật \x07 | 18/09 | 🟢 Thấp |
`;

    const buffer = await generateReportPdfBuffer('Báo Cáo Control Characters', controlCharsMarkdown);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it('supports 4-column action items table without STT column', async () => {
    const fourColumnMarkdown = `# 📑 BÁO CÁO ĐIỀU HÀNH TỔNG HỢP
*Thời gian: 17/09/2026 | Toàn hệ thống*

---

## 📋 5. KẾ HOẠCH & HÀNH ĐỘNG TIẾP THEO
| Hành động | Người phụ trách | Thời hạn | Ưu tiên |
|---|---|---|---|
| Rà soát quy trình đón khách và mở rộng chỗ để xe | Bảo vệ | 18/09 | 🟡 T.Bình |
| Kiểm tra lại hệ thống POS thu ngân | Thu ngân | 18/09 | 🔴 Cao |
`;

    const buffer = await generateReportPdfBuffer('Báo Cáo 4 Cột', fourColumnMarkdown);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it('handles minimal 1-row table and empty table gracefully', async () => {
    const singleRowMarkdown = `# 📑 BÁO CÁO ĐIỀU HÀNH
*Thời gian: 17/09/2026 | Toàn hệ thống*

---

## 📋 5. KẾ HOẠCH & HÀNH ĐỘNG TIẾP THEO
| # | Hành động | Người phụ trách | Thời hạn | Ưu tiên |
|---|---|---|---|---|
| 1 | Việc duy nhất cần làm | Trưởng ca | Hôm nay | 🔴 Cao |
`;

    const buffer = await generateReportPdfBuffer('Báo Cáo 1 Dòng', singleRowMarkdown);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);

    const emptyTableMarkdown = `# 📑 BÁO CÁO ĐIỀU HÀNH
*Thời gian: 17/09/2026 | Toàn hệ thống*

---

## 📋 5. KẾ HOẠCH & HÀNH ĐỘNG TIẾP THEO
| # | Hành động | Người phụ trách | Thời hạn | Ưu tiên |
|---|---|---|---|---|
`;
    const emptyBuffer = await generateReportPdfBuffer('Báo Cáo Bảng Trống', emptyTableMarkdown);
    expect(emptyBuffer).toBeInstanceOf(Buffer);
  });

  it('renders generic markdown tables with multiple columns and wrapping text', async () => {
    const genericTableMarkdown = `# 📑 BÁO CÁO TỔNG KẾT
*Thời gian: 17/09/2026 | Toàn hệ thống*

---

## 📊 BẢNG THEO DÕI NGUYÊN VẬT LIỆU
| Mã NVL | Tên nguyên vật liệu | Số lượng tồn | Tình trạng kho | Ghi chú vận hành |
|---|---|---|---|---|
| NVL01 | Hạt nổ dâu tây cao cấp đóng gói | 45 hộp | Còn hàng | Đã đối chiếu số liệu kiểm kho sáng |
| NVL02 | Sữa đặc có đường đặc biệt dành cho pha chế | 120 lon | Cảnh báo tồn | Cần đặt thêm trước 16:00 chiều nay |
| NVL03 | Trân châu Oolong mẻ đặc biệt | 12 kg | Đạt tiêu chuẩn | Đang nấu bổ sung tại bếp trung tâm |
`;

    const buffer = await generateReportPdfBuffer('Báo Cáo Bảng Generic', genericTableMarkdown);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it('Phase03 regression: PDF metadata bar does NOT show "báo cáo:" when markdown has **Thời gian báo cáo:** syntax', async () => {
    // This Markdown pattern triggered the bug: regex extracted " báo cáo:" as the time value
    const buggyMarkdown = `# 📑 BÁO CÁO ĐIỀU HÀNH
*   **Thời gian báo cáo:** Ngày 18/09/2026.

## 🎯 1. TÓM TẮT 3 ĐIỂM CỐT LÕI
* Hệ thống vận hành ổn định.

## 📋 5. KẾ HOẠCH & HÀNH ĐỘNG TIẾP THEO (Next Steps & Assignments)
| # | Hành động | Người phụ trách | Thời hạn | Ưu tiên |
|---|---|---|---|---|
| 1 | Kiểm tra định kỳ | Kỹ thuật | Cuối ca | 🟡 Trung bình |
`;
    // When no options.periodText is provided, the safe regex should extract "Ngày 18/09/2026." not "báo cáo:"
    const buffer = await generateReportPdfBuffer('Báo Cáo Test', buggyMarkdown);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
    const header = buffer.subarray(0, 5).toString('ascii');
    expect(header).toBe('%PDF-');
    // PDF content check: "báo cáo:" must not appear as time value in binary stream
    const pdfText = buffer.toString('latin1');
    // The rendered period string "báo cáo:" should not appear in the PDF
    expect(pdfText).not.toContain('\u21d2 Th\u1eddi gian: b\u00e1o c\u00e1o:');
  });

  it('Phase03: explicit options.periodText is used as metadata bar period (SSoT)', async () => {
    const markdownWithBrokenTime = `# 📑 BÁO CÁO
*   **Thời gian báo cáo:** Ngày 18/09/2026.

## 🎯 1. TÓM TẮT
* Bullet nội dung.
`;
    // When explicit periodText is passed, it should always be used
    const buffer = await generateReportPdfBuffer('Test Report', markdownWithBrokenTime, {
      periodText: '17:00 17/09/2026 — 13:03 18/09/2026',
    });
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
    const header = buffer.subarray(0, 5).toString('ascii');
    expect(header).toBe('%PDF-');
  });
});
