import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: {},
}));

import { parseActionItemsFromMarkdown } from '../src/modules/ai-reports/report-action-item-parser.js';
import { formatTasksForZaloMessage } from '../src/modules/ai-reports/zalo-report-sender.js';

describe('Action Items Markdown Parser (Phase 3)', () => {
  it('parses structured markdown table from Section 5', () => {
    const reportMarkdown = `# 📑 BÁO CÁO ĐIỀU HÀNH TỔNG HỢP

## 🎯 1. TÓM TẮT 3 ĐIỂM CỐT LÕI
- Điểm 1
- Điểm 2

## 📋 5. KẾ HOẠCH & HÀNH ĐỘNG TIẾP THEO (Next Steps & Assignments)
| # | Hành động | Người phụ trách | Thời hạn | Ưu tiên |
|---|---|---|---|---|
| 1 | Hoàn tất nấu trân châu oolong và kiểm tra tồn kho | Ca chiều (Hải Anh) | Ca chiều 16/09 | 🔴 Cao |
| 2 | Bắt buộc ghi lý do huỷ trong mọi báo cáo huỷ | Toàn bộ nhân sự | Từ ca kế tiếp | 🟡 Trung bình |
| 3 | Rà soát & xác minh 7 cốc 360 khách xin | Quản lý ca | Trong 24h | 🟢 Thấp |

---
*(Trạng thái nhóm không có hoạt động mới: Không có)*
`;

    const items = parseActionItemsFromMarkdown(reportMarkdown, 'Homey Co-Working', 'group-123');
    expect(items).toHaveLength(3);

    expect(items[0]).toMatchObject({
      id: 'task-1',
      task: 'Hoàn tất nấu trân châu oolong và kiểm tra tồn kho',
      assignee: 'Ca chiều (Hải Anh)',
      deadline: 'Ca chiều 16/09',
      priority: 'high',
      done: false,
      groupName: 'Homey Co-Working',
      groupThreadId: 'group-123',
    });

    expect(items[1]).toMatchObject({
      id: 'task-2',
      task: 'Bắt buộc ghi lý do huỷ trong mọi báo cáo huỷ',
      assignee: 'Toàn bộ nhân sự',
      deadline: 'Từ ca kế tiếp',
      priority: 'medium',
      done: false,
    });

    expect(items[2]).toMatchObject({
      id: 'task-3',
      task: 'Rà soát & xác minh 7 cốc 360 khách xin',
      assignee: 'Quản lý ca',
      deadline: 'Trong 24h',
      priority: 'low',
      done: false,
    });
  });

  it('gracefully falls back to parsing bullet points when table is missing', () => {
    const reportMarkdown = `
## 📋 5. KẾ HOẠCH & HÀNH ĐỘNG TIẾP THEO
- [ ] 1. Kiểm tra tồn kho nguyên vật liệu (Phụ trách: Nam | Hạn: Ca sáng mai)
- 2. Đổi mật khẩu wifi quán (Người làm: Kỹ thuật, deadline: Hôm nay)
- 🔴 Sửa máy lạnh phòng họp 2 (Phụ trách: Quản lý)
`;

    const items = parseActionItemsFromMarkdown(reportMarkdown);
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0].task).toContain('Kiểm tra tồn kho nguyên vật liệu');
    expect(items[0].assignee).toBe('Nam');
    expect(items[0].deadline).toBe('Ca sáng mai');
  });
});

describe('Zalo Tasks Broadcast Message Formatter (Phase 4)', () => {
  it('formats tasks into professional plain text with emojis and NO URLs', () => {
    const tasks = [
      {
        task: 'Nấu trân châu oolong',
        assignee: 'Hải Anh',
        deadline: 'Ca chiều',
        priority: 'high' as const,
        done: false,
      },
      {
        task: 'Kiểm tra máy pha cà phê',
        assignee: 'Quản lý',
        deadline: 'Trong 24h',
        priority: 'medium' as const,
        done: true,
      },
    ];

    const message = formatTasksForZaloMessage(
      'Báo Cáo Điều Hành Tức Thì (16/09/2026)',
      'Homey Co-Working',
      tasks,
      'Bàn giao ca chiều cho bạn Hải Anh',
    );

    // Verify key elements
    expect(message).toContain('📢 [BÀN GIAO CA & NHIỆM VỤ CẦN XỬ LÝ]');
    expect(message).toContain('Homey Co-Working');
    expect(message).toContain('💬 Ghi chú: Bàn giao ca chiều cho bạn Hải Anh');
    expect(message).toContain('🔴 Ưu tiên cao:');
    expect(message).toContain('1. Nấu trân châu oolong');
    expect(message).toContain('👉 Phụ trách: Hải Anh | Hạn: Ca chiều');
    expect(message).toContain('🟡 Ưu tiên trung bình:');
    expect(message).toContain('Kiểm tra máy pha cà phê [Đã xong]');
    expect(message).toContain('⚡ Đề nghị các nhân sự nhận việc kiểm tra và báo cáo tiến độ xử lý vào nhóm!');

    // Verify NO URLs are present (Anti-spam / Anti-blocking)
    expect(message).not.toContain('http://');
    expect(message).not.toContain('https://');
    expect(message).not.toContain('localhost');
  });
});
