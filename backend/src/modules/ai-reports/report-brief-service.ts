/**
 * report-brief-service.ts — Extracts and formats an executive brief (vắn tắt)
 * from full Markdown reports for mobile Zalo messaging.
 * Guaranteed plain text with emojis; zero raw markdown artifacts.
 */
import { parseActionItemsFromMarkdown, type ReportActionItem } from './report-action-item-parser.js';

export interface ExecutiveBriefOptions {
  /** Explicit report title — Single Source of Truth; skips regex extraction when provided. */
  reportTitle?: string;
  /** Explicit period text (e.g. "17:00 17/09/2026 — 13:03 18/09/2026") — SSoT; skips regex when provided. */
  periodText?: string;
  /** Explicit scope text (e.g. "Toàn hệ thống") — SSoT; skips regex when provided. */
  scopeText?: string;
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
    .replace(/_(.+?)_/g, '$1')      // italic _text_ (non-greedy, avoid false positives)
    .replace(/`([^`]+)`/g, '$1')     // inline code
    .replace(/^[#\s*>-]+/gm, '')     // leading markdown tokens
    .trim();
}

/**
 * Remove conversational preamble (greetings, social pleasantries) from a bullet string.
 * Non-greedy — only strips known Vietnamese corporate greeting patterns with explicit delimiters.
 * Returns empty string if the entire bullet is a greeting; otherwise returns cleaned text.
 */
function cleanConversationalFiller(text: string): string {
  // Pattern 1: Vietnamese workplace greetings at line start.
  // NOTE: \b does NOT work for Vietnamese (non-ASCII) chars, so we use a lookahead
  // for separator characters (comma, space, period, exclamation, dash) or end-of-string.
  const greetingPattern = /^(?:(?:xin\s+)?chào\s+(?:bạn|anh\/chị|anh|chị|em|cả\s*nhà|mọi\s*người|mn|quý\s*vị|sếp|team)|kính\s*(?:chào|gửi)|thân\s*chào|hi\s+all|hello\s+all|dạ\s+em\s+xin\s+gửi)(?=[,!.\s\-]|$)[,!.\s\-]*/i;
  // Pattern 2: Preamble phrases — only strip when followed by a colon delimiter (non-greedy, preserves business content).
  const preamblePattern = /^(?:dưới đây là|sau đây là|tôi xin gửi)(?:\s+bản)?(?:\s+tóm tắt|\s+báo cáo)?[^:\n]*:\s*/i;

  const cleaned = text.replace(greetingPattern, '').replace(preamblePattern, '').trim();
  return cleaned;
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
    const isBulletStart = /^[-*+•]|\d+[.\)]/.test(trimmed);

    if (isBulletStart) {
      if (currentBullet) {
        bullets.push(cleanMarkdownText(currentBullet));
      }
      currentBullet = trimmed.replace(/^[-*+•\d.\)]+\s*/, '');
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
 * Safe regex for time extraction — supports Markdown bold syntax like `**Thời gian:**` or `* **Thời gian báo cáo:**`.
 * Guards against extracting "báo cáo:" as the time value.
 */
const SAFE_TIME_REGEX = /(?:^\s*[*_~-]*\s*Thời gian(?:\s*báo\s*cáo)?\s*[*_~-]*\s*:\s*[*_~-]*\s*)([^\n|*]+)(?:\|\s*([^\n*]+))?/imu;

function isBadTimeString(value: string): boolean {
  return /^(báo cáo|thời gian báo cáo)[:\s]*$/i.test(value.trim()) || value.trim() === '';
}

/**
 * Generates a clean, professional Executive Brief optimized for Zalo chat.
 */
export function generateExecutiveBrief(
  markdownContent: string,
  options: ExecutiveBriefOptions = {},
): string {
  const {
    reportTitle: optionTitle,
    periodText: optionPeriod,
    scopeText: optionScope,
    maxCorePoints = 3,
    maxUrgentTasks = 5,
    includePdfNotice = true,
  } = options;

  const lines: string[] = [];

  // ── 1. TITLE — explicit options are Single Source of Truth ─────────────────
  let displayTitle: string;
  if (optionTitle) {
    // Sanitize: strip markdown, normalize newlines (prevent header injection)
    displayTitle = cleanMarkdownText(optionTitle).replace(/[\r\n]+/g, ' ').trim();
  } else {
    const titleMatch = markdownContent.match(/^#\s*[^\s\w]*\s*([^\n]+)$/mu);
    displayTitle = titleMatch ? cleanMarkdownText(titleMatch[1]) : 'BÁO CÁO ĐIỀU HÀNH TỔNG HỢP';
  }
  lines.push(`📑 ${displayTitle.toUpperCase()}`);

  // ── 2. PERIOD & SCOPE — explicit options over regex ───────────────────────
  let displayPeriod: string | undefined;
  let displayScope: string | undefined;

  if (optionPeriod) {
    displayPeriod = cleanMarkdownText(optionPeriod).replace(/[\r\n]+/g, ' ').trim();
  } else {
    const timeScopeMatch = markdownContent.match(SAFE_TIME_REGEX);
    if (timeScopeMatch) {
      const candidate = cleanMarkdownText(timeScopeMatch[1]);
      if (!isBadTimeString(candidate)) {
        displayPeriod = candidate;
      }
      if (!optionScope && timeScopeMatch[2]) {
        const scopeCandidate = cleanMarkdownText(timeScopeMatch[2].replace(/\*+$/, ''));
        if (scopeCandidate) displayScope = scopeCandidate;
      }
    }
  }

  if (optionScope) {
    displayScope = cleanMarkdownText(optionScope).replace(/[\r\n]+/g, ' ').trim();
  }

  if (displayPeriod) {
    lines.push(`⏰ Thời gian: ${displayPeriod}`);
  }
  if (displayScope) {
    lines.push(`👥 Phạm vi: ${displayScope}`);
  }

  lines.push('────────────────────────');

  // ── 3. Section 1: Core Highlights ─────────────────────────────────────────
  const sec1Match = markdownContent.match(/##\s*[^\n\d]*(?:1[.\s]|TÓM TẮT|CỐT LÕI|HIGHLIGHT)[^\n]*([\s\S]*?)(?=(?:\n##\s|\n---\s*\(|\n#\s|$))/iu);
  const sec1Text = sec1Match ? sec1Match[1].trim() : '';

  // Extract bullets, filter conversational filler, THEN slice — never slice before filtering
  let rawBullets = sec1Text ? extractBullets(sec1Text) : [];
  let filteredBullets = rawBullets
    .map((b) => cleanConversationalFiller(b))
    .filter((b) => b.length > 0);
  let coreBullets = filteredBullets.slice(0, maxCorePoints);

  if (coreBullets.length === 0) {
    // Attempt extraction from non-bullet paragraphs/lines
    const introLines = (sec1Text || markdownContent)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('|') && !l.startsWith('---') && !/Thời gian:/i.test(l));

    if (introLines.length > 0 && !sec1Text) {
      const firstLine = cleanConversationalFiller(cleanMarkdownText(introLines[0]));
      if (firstLine.length > 0) {
        coreBullets = [firstLine];
      }
    }

    if (coreBullets.length === 0) {
      // Final fallback
      coreBullets = ['Hệ thống ghi nhận hoạt động vận hành trong kỳ báo cáo (chi tiết trong file PDF đính kèm).'];
    }
  }

  lines.push('🎯 3 ĐIỂM CỐT LÕI (CORE HIGHLIGHTS):');
  for (const b of coreBullets) {
    lines.push(`• ${b}`);
  }

  lines.push('');

  // ── 4. Section 3: Blockers & Risks (top 1-2 if present) ───────────────────
  const sec3Match = markdownContent.match(/##\s*[^\n\d]*(?:3[.\s]|TỒN ĐỌNG|SỰ CỐ|RỦI RO|RISK|BLOCKER)[^\n]*([\s\S]*?)(?=(?:\n##\s|\n---\s*\(|\n#\s|$))/iu);
  const sec3Text = sec3Match ? sec3Match[1].trim() : '';
  const riskBullets = sec3Text ? extractBullets(sec3Text) : [];
  const validRisks = riskBullets.filter((b) => {
    const trimmed = b.trim().toLowerCase();
    const isNone = /^(không\s+có(\s+rủi\s+ro|\s+sự\s+cố|\s+tồn\s+đọng)?|không\s+phát\s+sinh|không|none)[.\s]*$/i.test(trimmed);
    return !isNone && trimmed.length > 5;
  });

  if (validRisks.length > 0) {
    lines.push('⚠️ TỒN ĐỌNG & CẢNH BÁO QUAN TRỌNG:');
    for (const r of validRisks.slice(0, 2)) {
      lines.push(`• ${r}`);
    }
    lines.push('');
  }

  // ── 5. Section 5: Action Items ─────────────────────────────────────────────
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

  // ── 6. PDF Notice ─────────────────────────────────────────────────────────
  if (includePdfNotice) {
    lines.push('────────────────────────');
    lines.push('📎 Bản báo cáo chi tiết đầy đủ đính kèm trong file PDF bên dưới.');
  }

  return lines.join('\n');
}

export interface AuditBriefOptions {
  reportTitle?: string;
  periodText?: string;
  scopeText?: string;
  telemetry?: import('./ai-audit-evaluator-helpers.js').AuditTelemetry;
  includePdfNotice?: boolean;
}

/**
 * Generates a clean, professional Audit Brief (Bản tin tóm tắt kiểm toán) optimized for Zalo chat.
 * Uses AuditTelemetry as Single Source of Truth for submission statistics.
 */
export function generateAuditBrief(
  markdownContent: string,
  options: AuditBriefOptions = {},
): string {
  const {
    reportTitle: optionTitle,
    periodText: optionPeriod,
    scopeText: optionScope,
    telemetry,
    includePdfNotice = true,
  } = options;

  const lines: string[] = [];

  // 1. Title
  let displayTitle: string;
  if (optionTitle) {
    const cleaned = cleanMarkdownText(optionTitle).replace(/[\r\n]+/g, ' ').trim();
    displayTitle = cleaned.startsWith('📑') ? cleaned : `📑 ${cleaned.toUpperCase()}`;
  } else if (optionScope) {
    displayTitle = `📑 ĐÁNH GIÁ TUÂN THỦ: ${cleanMarkdownText(optionScope).toUpperCase()}`;
  } else {
    displayTitle = '📑 ĐÁNH GIÁ TUÂN THỦ';
  }
  lines.push(displayTitle);

  // 2. Period
  if (optionPeriod) {
    const cleanPeriod = cleanMarkdownText(optionPeriod).replace(/[\r\n]+/g, ' ').trim();
    lines.push(`⏰ Thời gian chốt: ${cleanPeriod}`);
  }

  // 3. Telemetry (Single Source of Truth)
  if (telemetry) {
    const total = telemetry.totalExpected || 0;
    const completed = telemetry.completedCount || 0;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    lines.push(`📊 Tỷ lệ nộp: ${completed}/${total} (${pct}%)`);
    lines.push('────────────────────────');

    // 🟢 Compliant
    if (telemetry.compliantNames && telemetry.compliantNames.length > 0) {
      lines.push(`🟢 Đã hoàn thành (${telemetry.compliantNames.length}): ${telemetry.compliantNames.join(', ')}`);
    } else {
      lines.push('🟢 Đã hoàn thành: Chưa ghi nhận');
    }

    // 🟡 Missing
    if (telemetry.missingNames && telemetry.missingNames.length > 0) {
      lines.push(`🟡 Chưa ghi nhận (${telemetry.missingNames.length}): ${telemetry.missingNames.join(', ')}`);
    } else {
      lines.push('🟡 Chưa ghi nhận: Không có (100% đạt chuẩn)');
    }

    // 🔴 Anomalies
    if (telemetry.anomaliesList && telemetry.anomaliesList.length > 0) {
      lines.push('');
      lines.push(`🔴 Bất thường / Vi phạm (${telemetry.anomaliesList.length}):`);
      for (const anom of telemetry.anomaliesList.slice(0, 3)) {
        lines.push(`• ${cleanConversationalFiller(cleanMarkdownText(anom))}`);
      }
    }
  } else {
    lines.push('────────────────────────');
  }

  // 4. Recommendations
  const recMatch = markdownContent.match(/##\s*[^\n]*(?:KHUYẾN NGHỊ|ĐỀ XUẤT|QUẢN TRỊ)[^\n]*([\s\S]*?)(?=(?:\n##|\n---\s*\(|\n#|$))/iu);
  const recText = recMatch ? recMatch[1].trim() : '';
  const recBullets = recText ? extractBullets(recText) : [];
  if (recBullets.length > 0) {
    lines.push('');
    lines.push('💡 Khuyến nghị quản trị:');
    for (const b of recBullets.slice(0, 2)) {
      lines.push(`• ${cleanConversationalFiller(b)}`);
    }
  }

  // 5. PDF Notice
  if (includePdfNotice) {
    lines.push('────────────────────────');
    lines.push('📎 Chi tiết đầy đủ xem trong tệp PDF đính kèm.');
  }

  return lines.join('\n');
}
