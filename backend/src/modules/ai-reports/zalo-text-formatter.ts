/**
 * zalo-text-formatter.ts — Cleans and transforms full Markdown reports
 * into mobile-optimized plain text typography for Zalo messaging.
 * Converts markdown tables into readable task cards and splits messages smartly by section.
 */
import { parseActionItemsFromMarkdown, type ReportActionItem } from './report-action-item-parser.js';

/**
 * Remove markdown bold, italic, code markers, headers, and excessive tokens.
 */
export function stripMarkdownTokens(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^---$/gm, '────────────────────────')
    .trim();
}

/**
 * Transforms full markdown report into clean Zalo chat plain text typography.
 */
export function formatMarkdownForZalo(markdown: string): string {
  if (!markdown || !markdown.trim()) return '';

  const lines = markdown.split('\n');
  const output: string[] = [];
  let inSection5Table = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // 1. Main Document Title (# ...)
    if (/^#\s+[^\n]+/mu.test(trimmed)) {
      const title = stripMarkdownTokens(trimmed.replace(/^#\s*[^\w\s]*\s*/u, ''));
      output.push(`📑 ${title.toUpperCase()}`);
      continue;
    }

    // 2. Metadata line (*Thời gian: ...*)
    if (/^\*Thời gian:/iu.test(trimmed)) {
      const match = trimmed.match(/^\*Thời gian:\s*([^*|]+)(?:\|\s*([^]+))?\*/iu);
      if (match) {
        output.push(`⏰ Thời gian: ${stripMarkdownTokens(match[1])}`);
        if (match[2]) {
          output.push(`👥 Phạm vi: ${stripMarkdownTokens(match[2])}`);
        }
        continue;
      }
    }

    // 3. Horizontal Rule (---)
    if (/^---+$/.test(trimmed)) {
      output.push('────────────────────────');
      continue;
    }

    // 4. Check for Section 5 Header (Start of Table area)
    if (/^##\s*[^\n\d]*5[\.\s]/iu.test(trimmed)) {
      inSection5Table = true;
      output.push('\n📋 5. KẾ HOẠCH & HÀNH ĐỘNG TIẾP THEO (ACTION ITEMS)');

      // Extract structured action items and format them as clean cards
      const actionItems = parseActionItemsFromMarkdown(markdown);
      if (actionItems.length > 0) {
        const high = actionItems.filter((t) => t.priority === 'high');
        const med = actionItems.filter((t) => t.priority === 'medium' || !t.priority);
        const low = actionItems.filter((t) => t.priority === 'low');

        let counter = 1;
        if (high.length > 0) {
          output.push('🔴 Ưu tiên cao:');
          for (const t of high) {
            output.push(`${counter++}. ${t.task}`);
            output.push(`   👉 Phụ trách: ${t.assignee || 'Chưa phân công'} | Hạn: ${t.deadline || 'Trong ca'}`);
          }
        }

        if (med.length > 0) {
          output.push('🟡 Ưu tiên trung bình:');
          for (const t of med) {
            output.push(`${counter++}. ${t.task}`);
            output.push(`   👉 Phụ trách: ${t.assignee || 'Chưa phân công'} | Hạn: ${t.deadline || 'Trong ca'}`);
          }
        }

        if (low.length > 0) {
          output.push('🟢 Ưu tiên thấp:');
          for (const t of low) {
            output.push(`${counter++}. ${t.task}`);
            output.push(`   👉 Phụ trách: ${t.assignee || 'Chưa phân công'} | Hạn: ${t.deadline || 'Trong ca'}`);
          }
        }
      } else {
        output.push('✓ Không có nhiệm vụ cần xử lý.');
      }
      continue;
    }

    // If we are in Section 5 table lines, skip raw markdown table lines (| ... |)
    if (inSection5Table) {
      if (trimmed.startsWith('|') || /^[-:\s|]+$/.test(trimmed) || trimmed.toLowerCase().includes('bắt buộc trình bày')) {
        continue;
      }
      // If we encounter another section or end of table notes, reset flag
      if (trimmed.startsWith('##') || trimmed.startsWith('#')) {
        inSection5Table = false;
      }
    }

    // 5. Section Headers (## 1. / ## 2. / ## 3. / ## 4.)
    if (/^##\s+[^\n]+/mu.test(trimmed)) {
      const cleanHeader = stripMarkdownTokens(trimmed.replace(/^##\s*/, ''));
      output.push(`\n${cleanHeader}`);
      continue;
    }

    // 6. Subheaders (### ...)
    if (/^###\s+[^\n]+/mu.test(trimmed)) {
      const cleanSubheader = stripMarkdownTokens(trimmed.replace(/^###\s*/, ''));
      output.push(`\n▪️ ${cleanSubheader}`);
      continue;
    }

    // 7. Bullet items (* or -)
    if (/^[-*+•]|\d+[\.\)]/.test(trimmed)) {
      const isIndented = rawLine.startsWith('  ') || rawLine.startsWith('\t');
      const bulletContent = stripMarkdownTokens(trimmed.replace(/^[-*+•\d\.\)]+\s*/, ''));
      if (bulletContent) {
        if (isIndented) {
          output.push(`   - ${bulletContent}`);
        } else {
          output.push(`• ${bulletContent}`);
        }
      }
      continue;
    }

    // 8. Normal text lines
    if (trimmed) {
      output.push(stripMarkdownTokens(trimmed));
    } else {
      // Avoid consecutive empty lines
      if (output.length > 0 && output[output.length - 1] !== '') {
        output.push('');
      }
    }
  }

  return output.join('\n').trim();
}

/**
 * Smart splitting by section boundaries instead of cutting arbitrary sentences.
 */
export function splitReportBySections(
  content: string,
  maxLen = 2500,
  prefixFormat: (part: number, total: number) => string = (part, total) => `📋 [BÁO CÁO - PHẦN ${part}/${total}]\n\n`,
): string[] {
  if (content.length <= maxLen) return [content];

  // Split by section boundaries (\n\n or \n followed by icon/section marker)
  const sections = content.split(/(?=\n(?:[🎯✅⚠️📊📋▪️]|##|\d+\.))/g);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const section of sections) {
    if ((currentChunk + section).length <= maxLen) {
      currentChunk += section;
    } else {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      if (section.length <= maxLen) {
        currentChunk = section;
      } else {
        // Fallback for an unusually huge single section: split by newlines
        const lines = section.split('\n');
        currentChunk = '';
        for (const line of lines) {
          if ((currentChunk + '\n' + line).length <= maxLen) {
            currentChunk += (currentChunk ? '\n' : '') + line;
          } else {
            if (currentChunk.trim()) chunks.push(currentChunk.trim());
            if (line.length <= maxLen) {
              currentChunk = line;
            } else {
              for (let i = 0; i < line.length; i += maxLen) {
                const sub = line.slice(i, i + maxLen);
                if (i + maxLen < line.length) {
                  chunks.push(sub);
                } else {
                  currentChunk = sub;
                }
              }
            }
          }
        }
      }
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  const total = chunks.length;
  if (total <= 1) return chunks;

  return chunks.map((chunk, idx) => prefixFormat(idx + 1, total) + chunk);
}
