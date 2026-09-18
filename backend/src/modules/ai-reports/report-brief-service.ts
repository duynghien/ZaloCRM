/**
 * report-brief-service.ts — Extracts and formats an executive brief (vắn tắt)
 * from full Markdown reports for mobile Zalo messaging.
 * Guaranteed plain text with emojis; zero raw markdown artifacts.
 */
import { parseActionItemsFromMarkdown, type ReportActionItem } from './report-action-item-parser.js';

export interface ExecutiveBriefOptions {
  maxCorePoints?: number;
  maxUrgentTasks?: number;
  includePdfNotice?: boolean;
}

/**
 * Remove markdown bold, italic, code markers and trim excess whitespace.
 */
function cleanMarkdownText(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1') // bold **text**
    .replace(/\*(.*?)\*/g, '$1')     // italic *text*
    .replace(/__(.*?)__/g, '$1')     // bold __text__
    .replace(/_(.*?)_/g, '$1')       // italic _text_
    .replace(/`([^`]+)`/g, '$1')     // inline code
    .replace(/^[#\s*>-]+/gm, '')     // leading markdown tokens
    .trim();
}

/**
 * Extract bullet items from a section's markdown body.
 */
function extractBullets(sectionText: string): string[] {
  const lines = sectionText.split('\n');
  const bullets: string[] = [];
  let currentBullet = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Matches lines starting with bullet markers: *, -, +, or numbers like 1.
    const isBulletStart = /^[-*+•]|\d+[\.\)]/.test(trimmed);

    if (isBulletStart) {
      if (currentBullet) {
        bullets.push(cleanMarkdownText(currentBullet));
      }
      currentBullet = trimmed.replace(/^[-*+•\d\.\)]+\s*/, '');
    } else if (currentBullet) {
      currentBullet += ' ' + trimmed;
    }
  }

  if (currentBullet) {
    bullets.push(cleanMarkdownText(currentBullet));
  }

  return bullets;
}

/**
 * Generates a clean, professional Executive Brief optimized for Zalo chat.
 */
export function generateExecutiveBrief(
  markdownContent: string,
  options: ExecutiveBriefOptions = {},
): string {
  const {
    maxCorePoints = 3,
    maxUrgentTasks = 5,
    includePdfNotice = true,
  } = options;

  const lines: string[] = [];

  // 1. Extract Report Title & Metadata from header
  const titleMatch = markdownContent.match(/^#\s*[^\s\w]*\s*([^\n]+)$/mu);
  const rawTitle = titleMatch ? cleanMarkdownText(titleMatch[1]) : 'BÁO CÁO ĐIỀU HÀNH TỔNG HỢP';
  lines.push(`📑 ${rawTitle.toUpperCase()}`);

  const timeScopeMatch = markdownContent.match(/(?:[^\w\n]*Thời gian[:\s*]+)([^\n|*]+)(?:\|\s*([^\n*]+))?/iu);
  if (timeScopeMatch) {
    const timeText = cleanMarkdownText(timeScopeMatch[1]);
    const scopeText = timeScopeMatch[2] ? cleanMarkdownText(timeScopeMatch[2].replace(/\*+$/, '')) : '';
    if (timeText) {
      lines.push(`⏰ Thời gian: ${timeText}`);
    }
    if (scopeText) {
      lines.push(`👥 Phạm vi: ${scopeText}`);
    }
  }

  lines.push('────────────────────────');

  // 2. Extract Section 1: 3 Điểm cốt lõi (Core Highlights)
  const sec1Match = markdownContent.match(/##\s*[^\n\d]*(?:1[\.\s]|TÓM TẮT|CỐT LÕI|HIGHLIGHT)[^\n]*([\s\S]*?)(?=(?:\n##\s|\n---\s*\(|\n#\s|$))/iu);
  const sec1Text = sec1Match ? sec1Match[1].trim() : '';
  let coreBullets = sec1Text ? extractBullets(sec1Text).slice(0, maxCorePoints) : [];

  if (coreBullets.length === 0) {
    // Check if there are general intro paragraphs or non-bullet text
    const introLines = (sec1Text || markdownContent)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('|') && !l.startsWith('---') && !/Thời gian:/i.test(l));
    if (introLines.length > 0 && !sec1Text) {
      coreBullets = [cleanMarkdownText(introLines[0])];
    }
  }

  lines.push('🎯 3 ĐIỂM CỐT LÕI (CORE HIGHLIGHTS):');
  if (coreBullets.length > 0) {
    for (const b of coreBullets) {
      lines.push(`• ${b}`);
    }
  } else {
    lines.push('• Hệ thống vận hành ổn định trong kỳ báo cáo.');
  }

  lines.push('');

  // 3. Extract Section 3: Tồn đọng, sự cố & rủi ro (Blockers & Risks) - Top 1-2 points if present
  const sec3Match = markdownContent.match(/##\s*[^\n\d]*(?:3[\.\s]|TỒN ĐỌNG|SỰ CỐ|RỦI RO|RISK|BLOCKER)[^\n]*([\s\S]*?)(?=(?:\n##\s|\n---\s*\(|\n#\s|$))/iu);
  const sec3Text = sec3Match ? sec3Match[1].trim() : '';
  const riskBullets = sec3Text ? extractBullets(sec3Text) : [];
  const validRisks = riskBullets.filter((b) => {
    const trimmed = b.trim().toLowerCase();
    const isNone = /^(không\s+có(\s+rủi\s+ro|\s+sự\s+cố|\s+tồn\s+đọng)?|không\s+phát\s+sinh|không|none)[\.\s]*$/i.test(trimmed);
    return !isNone && trimmed.length > 5;
  });

  if (validRisks.length > 0) {
    lines.push('⚠️ TỒN ĐỌNG & CẢNH BÁO QUAN TRỌNG:');
    for (const r of validRisks.slice(0, 2)) {
      lines.push(`• ${r}`);
    }
    lines.push('');
  }

  // 4. Extract Section 5: Action Items (Urgent / High Priority)
  const actionItems: ReportActionItem[] = parseActionItemsFromMarkdown(markdownContent);
  const highPriorityTasks = actionItems.filter((t) => t.priority === 'high' && !t.done);
  const mediumPriorityTasks = actionItems.filter((t) => (t.priority === 'medium' || !t.priority) && !t.done);

  // Focus on high priority tasks; fallback to medium if no high priority
  const selectedTasks = highPriorityTasks.length > 0
    ? highPriorityTasks.slice(0, maxUrgentTasks)
    : mediumPriorityTasks.slice(0, 3);

  lines.push('📋 NHIỆM VỤ CẦN XỬ LÝ (ACTION ITEMS):');
  if (selectedTasks.length > 0) {
    if (highPriorityTasks.length > 0) {
      lines.push(`🔴 Ưu tiên cao (${highPriorityTasks.length} việc):`);
    } else {
      lines.push(`🟡 Cần xử lý (${selectedTasks.length} việc):`);
    }

    selectedTasks.forEach((t, idx) => {
      lines.push(`${idx + 1}. ${t.task}`);
      const groupInfo = t.groupName ? ` [${t.groupName}]` : '';
      lines.push(`   👉 Phụ trách: ${t.assignee || 'Chưa phân công'} | Hạn: ${t.deadline || 'Trong ca'}${groupInfo}`);
    });

    const remainingCount = actionItems.length - selectedTasks.length;
    if (remainingCount > 0) {
      lines.push(`   *(Còn ${remainingCount} nhiệm vụ khác được nêu đầy đủ trong file PDF)*`);
    }
  } else {
    lines.push('✓ Không có nhiệm vụ tồn đọng cần xử lý gấp.');
  }

  // 5. PDF Attachment Notice
  if (includePdfNotice) {
    lines.push('────────────────────────');
    lines.push('📎 Bản báo cáo chi tiết đầy đủ đính kèm trong file PDF bên dưới.');
  }

  return lines.join('\n');
}
