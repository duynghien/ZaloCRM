import { describe, expect, it } from 'vitest';
import { generateExecutiveBrief, generateAuditBrief } from '../src/modules/ai-reports/report-brief-service.js';

describe('Report Brief Service', () => {
  const sampleMarkdown = `# 📑 BÁO CÁO ĐIỀU HÀNH TỔNG HỢP — TỨC THÌ
*Thời gian: 17:00 16/09/2026 — 09:40 17/09/2026 | Số nhóm theo dõi: 1 (1 nhóm có hoạt động)*

---

## 🎯 1. TÓM TẮT 3 ĐIỂM CỐT LÕI (Core Highlights)
* **Sẵn sàng vận hành cơ bản:** Các công việc chuẩn bị đầu ca sáng và ca chiều tại Homey Đại Phúc đã được báo cáo hoàn thành và đạt yêu cầu.
* **Rủi ro về tính minh bạch và kiểm soát:** Phát hiện nhiều điểm bất thường nghiêm trọng giữa báo cáo văn bản và ảnh chụp.
* **Thiếu sót trong báo cáo hoàn thành:** Một hạng mục sản xuất quan trọng (Trân châu Oolong) vẫn ở trạng thái đang nấu.

## ✅ 2. CÔNG VIỆC ĐÃ HOÀN THÀNH (Completed Actions)
* Homey Đại Phúc:
  * Ca sáng: Kiểm tra hoa quả, test máy.

## ⚠️ 3. TỒN ĐỌNG, SỰ CỐ & RỦI RO PHÁT SINH (Blockers & Risks)
* Trân châu Oolong: Báo cáo đang nấu lúc 01:04 nhưng không có cập nhật hoàn thành sau đó.

## 📊 4. SỐ LIỆU, CHỈ SỐ & KPI CHÍNH (Key Metrics)
* Doanh số: 12.500.000 VNĐ.

## 📋 5. KẾ HOẠCH & HÀNH ĐỘNG TIẾP THEO (Next Steps & Assignments)
| # | Hành động | Người phụ trách | Thời hạn | Ưu tiên |
|---|---|---|---|---|
| 1 | Yêu cầu làm rõ mục đích ảnh dưa hấu 9.5kg | Trưởng ca | 17/09 (cuối ca) | 🔴 Cao |
| 2 | Cung cấp lý do hủy shot cà phê test máy | Trưởng ca | 17/09 (cuối ca) | 🔴 Cao |
| 3 | Kiểm tra định kỳ máy lạnh | Kỹ thuật | 18/09 | 🟢 Thấp |

---
*(Trạng thái nhóm không có hoạt động mới: Không có)*
`;

  it('generates a clean executive brief without raw markdown artifacts', () => {
    const brief = generateExecutiveBrief(sampleMarkdown);

    // Verify title & meta
    expect(brief).toContain('📑 BÁO CÁO ĐIỀU HÀNH TỔNG HỢP — TỨC THÌ');
    expect(brief).toContain('⏰ Thời gian: 17:00 16/09/2026 — 09:40 17/09/2026');
    expect(brief).toContain('👥 Phạm vi: Số nhóm theo dõi: 1 (1 nhóm có hoạt động)');

    // Verify Section 1
    expect(brief).toContain('🎯 3 ĐIỂM CỐT LÕI (CORE HIGHLIGHTS):');
    expect(brief).toContain('• Sẵn sàng vận hành cơ bản: Các công việc chuẩn bị');

    // Verify Section 3
    expect(brief).toContain('⚠️ TỒN ĐỌNG & CẢNH BÁO QUAN TRỌNG:');
    expect(brief).toContain('• Trân châu Oolong: Báo cáo đang nấu lúc 01:04');

    // Verify Section 5 Urgent tasks
    expect(brief).toContain('📋 NHIỆM VỤ CẦN XỬ LÝ (ACTION ITEMS):');
    expect(brief).toContain('🔴 Ưu tiên cao (2 việc):');
    expect(brief).toContain('1. Yêu cầu làm rõ mục đích ảnh dưa hấu 9.5kg');
    expect(brief).toContain('👉 Phụ trách: Trưởng ca | Hạn: 17/09 (cuối ca)');
    expect(brief).toContain('2. Cung cấp lý do hủy shot cà phê test máy');
    expect(brief).toContain('*(Còn 1 nhiệm vụ khác được nêu đầy đủ trong file PDF)*');

    // Verify PDF notice
    expect(brief).toContain('📎 Bản báo cáo chi tiết đầy đủ đính kèm trong file PDF bên dưới.');

    // NO raw markdown artifacts
    expect(brief).not.toContain('**');
    expect(brief).not.toContain('##');
    expect(brief).not.toContain('|---|');
    expect(brief).not.toContain('| 1 |');

    // Ensure length is compact (< 1500 chars)
    expect(brief.length).toBeLessThan(1500);
  });

  it('handles report with no blockers and no urgent tasks gracefully', () => {
    const minimalMarkdown = `# Báo Cáo Ca Chiều
*Thời gian: 12:00 — 18:00*

## 1. TÓM TẮT
* Ca làm việc diễn ra suôn sẻ, không phát sinh sự cố.

## 3. TỒN ĐỌNG, SỰ CỐ & RỦI RO
* Không có

## 5. KẾ HOẠCH
| # | Hành động | Người phụ trách | Thời hạn | Ưu tiên |
|---|---|---|---|---|
| 1 | Lau dọn quầy bar cuối ngày | Nhân viên ca | 18:00 | 🟡 Trung bình |
`;

    const brief = generateExecutiveBrief(minimalMarkdown);
    expect(brief).toContain('📑 BÁO CÁO CA CHIỀU');
    expect(brief).toContain('• Ca làm việc diễn ra suôn sẻ, không phát sinh sự cố.');
    expect(brief).not.toContain('⚠️ TỒN ĐỌNG & CẢNH BÁO QUAN TRỌNG:');
    expect(brief).toContain('🟡 Cần xử lý (1 việc):');
    expect(brief).toContain('1. Lau dọn quầy bar cuối ngày');
    expect(brief).toContain('👉 Phụ trách: Nhân viên ca | Hạn: 18:00');
  });

  it('handles completely blank or fallback markdown gracefully', () => {
    const brief = generateExecutiveBrief('');
    expect(brief).toContain('📑 BÁO CÁO ĐIỀU HÀNH TỔNG HỢP');
    expect(brief).toContain('• Hệ thống ghi nhận hoạt động vận hành trong kỳ báo cáo');
    expect(brief).toContain('✓ Không có nhiệm vụ tồn đọng cần xử lý gấp.');
  });

  // ── Phase 03 new cases ────────────────────────────────────────────────────

  it('Case 1: explicit reportTitle and periodText override markdown regex (Single Source of Truth)', () => {
    // Even if markdown has a different/broken header, explicit options win
    const brokenMarkdown = `# 📑 BÁO CÁO SAI
*Thời gian báo cáo: Ngày 18/09/2026*

## 🎯 1. TÓM TẮT
* Công việc A hoàn thành.
`;
    const brief = generateExecutiveBrief(brokenMarkdown, {
      reportTitle: 'Báo Cáo Điều Hành Tức Thì',
      periodText: '17:00 17/09/2026 — 13:03 18/09/2026',
    });
    // Explicit reportTitle used
    expect(brief).toContain('📑 BÁO CÁO ĐIỀU HÀNH TỨC THÌ');
    // Explicit periodText used — should NOT appear as "báo cáo:"
    expect(brief).toContain('⏰ Thời gian: 17:00 17/09/2026 — 13:03 18/09/2026');
    expect(brief).not.toContain('báo cáo:');
  });

  it('Case 1b: reportTitle with newline is normalized to single line (no header injection)', () => {
    const brief = generateExecutiveBrief('', {
      reportTitle: 'Tiêu đề\n⏰ Thời gian: INJECTED',
      periodText: '10:00 — 18:00',
    });
    // The injected section header must not appear as a real "⏰ Thời gian:" bullet
    const timeLines = brief.split('\n').filter((l) => l.startsWith('⏰ Thời gian:'));
    // Only one ⏰ line should exist (from periodText), and it should be "10:00 — 18:00"
    expect(timeLines.length).toBe(1);
    expect(timeLines[0]).toBe('⏰ Thời gian: 10:00 — 18:00');
  });

  it('Case 2: safe time regex handles Markdown bold `**Thời gian:**` without "báo cáo:" contamination', () => {
    const markdownWithBoldTime = `# 📑 BÁO CÁO THỬ NGHIỆM
*   **Thời gian báo cáo:** Ngày 18/09/2026.

## 🎯 1. TÓM TẮT
* Bullet hợp lệ số 1.
`;
    const brief = generateExecutiveBrief(markdownWithBoldTime);
    // Must NOT produce "báo cáo:" as the time value
    expect(brief).not.toContain('⏰ Thời gian: báo cáo:');
    expect(brief).not.toContain('⏰ Thời gian:  báo cáo:');
  });

  it('Case 3: conversational filler is stripped (Vietnamese corporate greetings)', () => {
    const markdownWithGreetings = `# 📑 BÁO CÁO
*Thời gian: 10:00 — 18:00*

## 🎯 1. TÓM TẮT 3 ĐIỂM CỐT LÕI
* Chào cả nhà, tôi gửi báo cáo.
* Chào bạn, hôm nay như sau:
* Bullet nghiệp vụ hợp lệ: Doanh thu tăng 20%.
* Bullet nghiệp vụ 2: Đơn hàng hoàn thành đúng hạn.
`;
    // Use maxCorePoints:4 so business bullets can be reached after greeting cleanup
    const brief = generateExecutiveBrief(markdownWithGreetings, { maxCorePoints: 4 });
    // Greetings must not appear in core highlights
    expect(brief).not.toContain('Chào cả nhà');
    expect(brief).not.toContain('Chào bạn');
    // Business bullets must be present
    expect(brief).toContain('Doanh thu tăng 20%');
    expect(brief).toContain('Đơn hàng hoàn thành đúng hạn');
  });

  it('Case 4: business bullet starting with "Đây là tuần..." is NOT removed by filter', () => {
    const markdownWithBusinessBullet = `# 📑 BÁO CÁO
*Thời gian: 10:00 — 18:00*

## 🎯 1. TÓM TẮT 3 ĐIỂM CỐT LÕI
* Đây là tuần đầu tiên đạt mốc 500 đơn hàng.
* Báo cáo tóm tắt doanh thu: 50 triệu VNĐ trong tuần.
`;
    const brief = generateExecutiveBrief(markdownWithBusinessBullet);
    expect(brief).toContain('Đây là tuần đầu tiên đạt mốc 500 đơn hàng');
    expect(brief).toContain('Báo cáo tóm tắt doanh thu');
  });

  it('Case 5: filtering greetings before slice preserves enough valid core points', () => {
    // 2 greeting bullets + 3 valid bullets; after filtering should yield 3 valid bullets (not be cut short)
    const markdownMixed = `# 📑 BÁO CÁO
*Thời gian: 10:00 — 18:00*

## 🎯 1. TÓM TẮT 3 ĐIỂM CỐT LÕI
* Chào bạn,
* Xin chào cả nhà,
* Điểm cốt lõi 1: Hệ thống vận hành ổn định.
* Điểm cốt lõi 2: Doanh số đạt 80% kế hoạch.
* Điểm cốt lõi 3: Không phát sinh sự cố nghiêm trọng.
`;
    const brief = generateExecutiveBrief(markdownMixed, { maxCorePoints: 3 });
    // Should have 3 valid bullets, not fewer
    const bulletLines = brief.split('\n').filter((l) => l.startsWith('•'));
    expect(bulletLines.length).toBeGreaterThanOrEqual(3);
    expect(brief).toContain('Điểm cốt lõi 1');
    expect(brief).toContain('Điểm cốt lõi 2');
    expect(brief).toContain('Điểm cốt lõi 3');
    // Greetings must not appear
    expect(brief).not.toContain('Chào bạn');
    expect(brief).not.toContain('Xin chào');
  });

  describe('generateAuditBrief', () => {
    const auditMarkdown = `# 📋 BÁO CÁO GIÁM SÁT TUÂN THỦ: Homey Co-working
## 🟢 ĐÃ HOÀN THÀNH (ĐẠT CHUẨN)
- Nguyễn Văn A: nộp báo cáo lúc 09:30

## 🟡 CHƯA GHI NHẬN (CẦN ĐỐI CHIẾU)
- Trần Thị B: chưa gửi báo cáo

## 🔴 BẤT THƯỜNG / NỘP MUỘN / CHẤT LƯỢNG KÉM
- Lê Văn C: gửi ảnh bị mờ

## 💡 KHUYẾN NGHỊ QUẢN TRỊ
- Nhắc nhở nhân sự chụp lại hóa đơn rõ nét.
- Thiết lập chốt kiểm tra phụ lúc 14:00.
`;

    it('generates a clean audit brief using telemetry as Single Source of Truth', () => {
      const telemetry = {
        totalExpected: 3,
        completedCount: 1,
        missingCount: 1,
        anomaliesCount: 1,
        compliantNames: ['Nguyễn Văn A'],
        missingNames: ['Trần Thị B'],
        anomaliesList: ['Lê Văn C gửi ảnh mờ không thể đối soát'],
      };

      const brief = generateAuditBrief(auditMarkdown, {
        reportTitle: 'Đánh Giá Tuân Thủ: Homey Co-working',
        periodText: '10:00 (Giám sát Homey Co-working)',
        scopeText: 'Homey Co-working',
        telemetry,
      });

      expect(brief).toContain('📑 ĐÁNH GIÁ TUÂN THỦ: HOMEY CO-WORKING');
      expect(brief).toContain('⏰ Thời gian chốt: 10:00 (Giám sát Homey Co-working)');
      expect(brief).toContain('📊 Tỷ lệ nộp: 1/3 (33%)');
      expect(brief).toContain('🟢 Đã hoàn thành (1): Nguyễn Văn A');
      expect(brief).toContain('🟡 Chưa ghi nhận (1): Trần Thị B');
      expect(brief).toContain('🔴 Bất thường / Vi phạm (1):');
      expect(brief).toContain('• Lê Văn C gửi ảnh mờ không thể đối soát');
      expect(brief).toContain('💡 Khuyến nghị quản trị:');
      expect(brief).toContain('• Nhắc nhở nhân sự chụp lại hóa đơn rõ nét.');
      expect(brief).toContain('📎 Chi tiết đầy đủ xem trong tệp PDF đính kèm.');
    });

    it('handles 100% compliance in audit brief correctly', () => {
      const telemetry = {
        totalExpected: 2,
        completedCount: 2,
        missingCount: 0,
        anomaliesCount: 0,
        compliantNames: ['A', 'B'],
        missingNames: [],
        anomaliesList: [],
      };

      const brief = generateAuditBrief(auditMarkdown, {
        scopeText: 'Nhóm Vận Hành',
        telemetry,
      });

      expect(brief).toContain('📊 Tỷ lệ nộp: 2/2 (100%)');
      expect(brief).toContain('🟢 Đã hoàn thành (2): A, B');
      expect(brief).toContain('🟡 Chưa ghi nhận: Không có (100% đạt chuẩn)');
      expect(brief).not.toContain('🔴 Bất thường / Vi phạm');
    });
  });
});
