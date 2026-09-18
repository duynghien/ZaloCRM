/**
 * report-action-item-parser.ts — Parses structured action items from executive report Markdown (Section 5).
 */

export interface ReportActionItem {
  id: string;
  task: string;
  assignee: string;
  deadline: string;
  priority: 'high' | 'medium' | 'low';
  category?: 'anomaly_fraud' | 'compliance_missing_evidence' | 'operational_task';
  done: boolean;
  completedAt?: string;
  groupThreadId?: string;
  groupName?: string;
}

export function parseActionItemCategory(
  taskText: string,
): 'anomaly_fraud' | 'compliance_missing_evidence' | 'operational_task' {
  const lower = taskText.toLowerCase();
  if (
    lower.includes('[nhắc nhở chứng từ]') ||
    lower.includes('[compliance_missing_evidence]') ||
    lower.includes('thiếu ảnh cân') ||
    lower.includes('bổ sung ảnh cân') ||
    lower.includes('chưa chụp cân') ||
    lower.includes('thiếu màn hình đo') ||
    lower.includes('thiếu ảnh chụp cùng cân') ||
    lower.includes('chụp ảnh đặt trên cân') ||
    lower.includes('chụp ảnh kèm cân') ||
    lower.includes('thiếu chứng từ')
  ) {
    return 'compliance_missing_evidence';
  }
  if (
    lower.includes('[bất thường]') ||
    lower.includes('[anomaly_fraud]') ||
    lower.includes('gian lận') ||
    lower.includes('sai lệch trọng lượng') ||
    lower.includes('sai lệch số liệu')
  ) {
    return 'anomaly_fraud';
  }
  return 'operational_task';
}

function parsePriority(raw: string): 'high' | 'medium' | 'low' {
  const lower = raw.toLowerCase();
  if (lower.includes('cao') || lower.includes('high') || lower.includes('🔴')) return 'high';
  if (lower.includes('thấp') || lower.includes('low') || lower.includes('🟢')) return 'low';
  return 'medium';
}

function extractSection5(markdown: string): string {
  // Stop at any ## heading, plain --- divider, or top-level # heading — prevents footnote bleed-through
  const section5Regex = /##\s*[^\n\d]*5[.\s][^\n]*([\s\S]*?)(?=(?:\n##\s|\n---|\n#\s|$))/iu;
  const match = markdown.match(section5Regex);
  return match ? match[1].trim() : '';
}

/**
 * Extracts structured action items from executive report Section 5.
 * Supports Markdown tables (| # | Hành động | Người phụ trách | Thời hạn | Ưu tiên |)
 * with graceful fallback to bullet points.
 */
export function parseActionItemsFromMarkdown(
  markdown: string,
  defaultGroupName?: string,
  defaultGroupThreadId?: string,
): ReportActionItem[] {
  const sectionText = extractSection5(markdown);
  if (!sectionText) return [];

  const items: ReportActionItem[] = [];
  const lines = sectionText.split('\n').map((l) => l.trim()).filter(Boolean);

  // 1. Try parsing Markdown table rows
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    // Skip technical footnote lines — they must never become CRM action items
    if (/^[-*•]?\s*\*?Ghi chú[:\s]/i.test(line)) continue;
    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter((c, idx, arr) => idx > 0 && idx < arr.length - 1);

    // Skip separator lines like |---|---|...
    if (cells.length === 0 || cells.every((c) => /^[-:\s]+$/.test(c))) continue;

    // Skip header row
    const firstCell = cells[0].toLowerCase();
    if (firstCell === '#' || firstCell === 'stt' || firstCell.includes('hành động')) continue;

    if (cells.length >= 2) {
      let task = '';
      let assignee = 'Chưa phân công';
      let deadline = 'Trong ca';
      let priority: 'high' | 'medium' | 'low' = 'medium';

      if (cells.length >= 5) {
        // | # | Hành động | Người phụ trách | Thời hạn | Ưu tiên |
        task = cells[1];
        assignee = cells[2] || assignee;
        deadline = cells[3] || deadline;
        priority = parsePriority(cells[4]);
      } else if (cells.length === 4) {
        // | Hành động | Người phụ trách | Thời hạn | Ưu tiên |
        task = cells[0];
        assignee = cells[1] || assignee;
        deadline = cells[2] || deadline;
        priority = parsePriority(cells[3]);
      } else if (cells.length === 3) {
        task = cells[0];
        assignee = cells[1] || assignee;
        deadline = cells[2] || deadline;
      } else {
        task = cells[0];
        assignee = cells[1] || assignee;
      }

      // Clean task numbering if included in text
      task = task.replace(/^\d+[\.\)]\s*/, '').trim();
      if (task.length > 2) {
        const category = parseActionItemCategory(task);
        if (category === 'compliance_missing_evidence' && priority === 'high') {
          priority = 'medium';
        }
        items.push({
          id: `task-${items.length + 1}`,
          task,
          assignee,
          deadline,
          priority,
          category,
          done: false,
          groupName: defaultGroupName,
          groupThreadId: defaultGroupThreadId,
        });
      }
    }
  }

  // 2. Fallback: Parse bullet points if table returned no rows
  if (items.length === 0) {
    for (const line of lines) {
      // Skip technical footnote lines
      if (/^[-*•]?\s*\*?Ghi chú[:\s]/i.test(line)) continue;
      const bulletMatch = line.match(/^[-*]\s+(?:\[[\sxX]\]\s+)?(?:\d+[\.\)]\s*)?([^\n]+)/);
      if (bulletMatch) {
        const fullTaskText = bulletMatch[1].trim();
        // Check for (Phụ trách: X | Hạn: Y) pattern
        let task = fullTaskText;
        let assignee = 'Chưa phân công';
        let deadline = 'Trong ca';
        let priority: 'high' | 'medium' | 'low' = 'medium';

        if (fullTaskText.toLowerCase().includes('ưu tiên cao') || fullTaskText.includes('🔴')) {
          priority = 'high';
        } else if (fullTaskText.toLowerCase().includes('ưu tiên thấp') || fullTaskText.includes('🟢')) {
          priority = 'low';
        }

        const metaMatch = fullTaskText.match(/[\(\[](?:phụ trách|người làm|giao)?:\s*([^,|\]\)]+)(?:[,|]\s*(?:hạn|deadline)?:\s*([^\]\)]+))?[\)\]]/i);
        if (metaMatch) {
          assignee = metaMatch[1].trim();
          if (metaMatch[2]) deadline = metaMatch[2].trim();
          task = fullTaskText.replace(metaMatch[0], '').trim();
        }

        task = task.replace(/^[🔴🟡🟢\s\-\*\d\.]+/, '').trim();
        if (task.length > 3) {
          const category = parseActionItemCategory(task);
          if (category === 'compliance_missing_evidence' && priority === 'high') {
            priority = 'medium';
          }
          items.push({
            id: `task-${items.length + 1}`,
            task,
            assignee,
            deadline,
            priority,
            category,
            done: false,
            groupName: defaultGroupName,
            groupThreadId: defaultGroupThreadId,
          });
        }
      }
    }
  }

  return items;
}
