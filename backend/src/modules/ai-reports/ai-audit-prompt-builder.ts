import type { AiAuditRule } from './ai-audit-rule-service.js';

export interface AuditPromptParams {
  rule: AiAuditRule;
  groupName: string;
  personnel: string[];
  formattedMessages: string;
  imageCount: number;
}

/**
 * Builds instructions and context for multimodal audit evaluation with fuzzy matching.
 */
export function buildAuditPrompt(params: AuditPromptParams): string {
  const { rule, groupName, personnel, formattedMessages, imageCount } = params;

  let templateGuidance = '';
  switch (rule.templateType) {
    case 'schedule_submission':
      templateGuidance =
        'Kiểm tra việc gửi lịch trình/kế hoạch làm việc trong ngày của các nhân sự. Xác định nhân sự nào đã gửi kế hoạch rõ ràng, ai chưa gửi, ai gửi trễ.';
      break;
    case 'work_progress':
      templateGuidance =
        'Kiểm tra báo cáo tiến độ công việc/KPI trong ca làm việc. Đánh giá tính đầy đủ của số liệu công việc hoàn thành và công việc tồn đọng.';
      break;
    case 'image_verification':
      templateGuidance =
        'Kiểm tra tính hợp lệ của hình ảnh/biên bản chứng từ đính kèm (ảnh chụp rõ nét, có hóa đơn/chứng từ/hiện trường hợp lệ, không bị mờ/chụp lại màn hình gian lận).';
      break;
    case 'custom':
    default:
      templateGuidance = rule.customPrompt || 'Đánh giá tuân thủ quy trình làm việc theo quy định.';
      break;
  }

  const personnelSection =
    personnel.length > 0
      ? personnel.map((p, i) => `${i + 1}. ${p}`).join('\n')
      : '(Chưa có danh sách cố định - hãy phát hiện tất cả nhân sự xuất hiện hoặc gửi thông tin trong nhóm)';

  return `Bạn là Chuyên viên Kiểm toán & Giám sát Tuân thủ AI cấp cao của doanh nghiệp.
Nhiệm vụ của bạn là thẩm định và đánh giá tính tuân thủ báo cáo trong nhóm Zalo "${groupName}" tính đến mốc thời gian chốt: ${rule.runTime}.

=== TIÊU CHÍ NGHIỆP VỤ ===
${templateGuidance}
${rule.customPrompt && rule.templateType !== 'custom' ? `Yêu cầu bổ sung:\n${rule.customPrompt}` : ''}

=== QUY TẮC ĐỐI CHIẾU NHÂN SỰ & DANH TÍNH (FUZZY & ALIAS MATCHING) ===
- Danh sách nhân sự cần kiểm tra (${personnel.length} người):
${personnelSection}

- QUY TẮC MATCHING MỜ: Thành viên Zalo thường đặt tên có kèm icon/emoji, chức danh (ví dụ "Nguyễn Văn A 🚀 [Sales]"). Trong chat họ có thể xưng tên ngắn ("Văn A gửi báo cáo", "Em A nộp lịch"). Bạn PHẢI đối chiếu linh hoạt theo họ tên, tên gọi thân mật, bỏ qua emoji và chức vụ để nhận diện đúng danh tính, tránh báo oan nhân sự đã nộp.

=== DỮ LIỆU ĐỐI SOÁT ===
- Tin nhắn trò chuyện:
${formattedMessages || '(Không có tin nhắn nào trong khung thời gian quét)'}
- Số lượng hình ảnh đính kèm được cung cấp: ${imageCount} ảnh.

=== ĐỊNH DẠNG ĐẦU RA BẮT BUỘC ===
Bạn PHẢI trả về duy nhất một khối JSON hợp lệ theo cấu trúc sau (không kèm lời chào hay giải thích ngoài JSON):
\`\`\`json
{
  "telemetry": {
    "totalExpected": ${personnel.length},
    "completedCount": 0,
    "missingCount": 0,
    "anomaliesCount": 0,
    "compliantNames": ["Tên các bạn đã hoàn thành"],
    "missingNames": ["Tên các bạn chưa ghi nhận nộp"],
    "anomaliesList": ["Mô tả bất thường nếu có, ví dụ: nộp muộn, ảnh mờ, thiếu chứng từ"]
  },
  "supervisoryReportMarkdown": "# 📋 BÁO CÁO GIÁM SÁT TUÂN THỦ: ${groupName}..."
}
\`\`\`

Báo cáo giám sát trong "supervisoryReportMarkdown" phải định dạng chuẩn Markdown 3 tầng rõ ràng:
1. 🟢 **ĐÃ HOÀN THÀNH (COMPLIANT)**: Liệt kê nhân sự, nội dung tóm tắt nộp, thời gian nộp.
2. 🟡 **CHƯA GHI NHẬN (CẦN ĐỐI CHIẾU)**: Liệt kê nhân sự chưa thấy báo cáo hoặc thông tin chưa rõ.
3. 🔴 **BẤT THƯỜNG / NỘP MUỘN / CHẤT LƯỢNG KÉM**: Phân tích chi tiết các vi phạm, ảnh không đạt yêu cầu.
4. 💡 **KHUYẾN NGHỊ QUẢN TRỊ**: Đề xuất hành động cho quản lý nhóm.`;
}
