/**
 * report-pdf-service.ts — Generates professional Executive Report PDFs
 * with Vietnamese font support, Neo-Brutalism styling, and structured task tables.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface GeneratePdfOptions {
  authorName?: string;
  reportType?: string;
  /** Explicit period text — Single Source of Truth; skips Markdown regex when provided. */
  periodText?: string;
  /** Explicit scope text — Single Source of Truth; skips Markdown regex when provided. */
  scopeText?: string;
}

export interface GeneratedPdfFile {
  filePath: string;
  filename: string;
  cleanup: () => Promise<void>;
}

function resolveFontPaths(): { regular: string | null; bold: string | null } {
  const candidates = [
    path.join(process.cwd(), 'assets/fonts'),
    path.join(process.cwd(), 'backend/assets/fonts'),
    path.join(__dirname, '../../../assets/fonts'),
    path.join(__dirname, '../../assets/fonts'),
  ];

  for (const dir of candidates) {
    const regular = path.join(dir, 'Roboto-Regular.ttf');
    const bold = path.join(dir, 'Roboto-Bold.ttf');
    if (fs.existsSync(regular) && fs.existsSync(bold)) {
      return { regular, bold };
    }
  }

  return { regular: null, bold: null };
}

function cleanText(text: string): string {
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

function getSectionColor(title: string): string {
  const upper = title.toUpperCase();
  if (/1[\.\s]|TÓM TẮT|CỐT LÕI|HIGHLIGHT/.test(upper)) return '#0369A1';
  if (/2[\.\s]|HOÀN THÀNH|COMPLETED/.test(upper)) return '#15803D';
  if (/3[\.\s]|TỒN ĐỌNG|SỰ CỐ|RỦI RO|RISK|BLOCKER/.test(upper)) return '#B45309';
  if (/4[\.\s]|SỐ LIỆU|CHỈ SỐ|KPI|METRIC/.test(upper)) return '#4338CA';
  if (/5[\.\s]|KẾ HOẠCH|HÀNH ĐỘNG|ACTION/.test(upper)) return '#DC2626';
  return '#475569';
}

function isActionItemsTable(headerCells: string[]): boolean {
  const joined = headerCells.map((c) => c.toLowerCase()).join(' ');
  return (
    (joined.includes('hành động') || joined.includes('nhiệm vụ') || joined.includes('action')) &&
    (joined.includes('ưu tiên') || joined.includes('priority') || joined.includes('thời hạn') || joined.includes('phụ trách'))
  );
}

/**
 * Generate PDF buffer for an executive report.
 */
export async function generateReportPdfBuffer(
  reportTitle: string,
  markdownContent: string,
  options: GeneratePdfOptions = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 36, bottom: 44, left: 36, right: 36 },
      bufferPages: true,
      autoFirstPage: true,
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));

    // Register Unicode fonts
    const fonts = resolveFontPaths();
    if (fonts.regular && fonts.bold) {
      doc.registerFont('Roboto-Regular', fonts.regular);
      doc.registerFont('Roboto-Bold', fonts.bold);
      doc.font('Roboto-Regular');
    }

    const regularFont = fonts.regular ? 'Roboto-Regular' : 'Helvetica';
    const boldFont = fonts.bold ? 'Roboto-Bold' : 'Helvetica-Bold';

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const contentWidth = pageWidth - 72; // margins left: 36, right: 36

    // ── 1. HEADER BANNER ──────────────────────────────────────────────
    doc.rect(36, 36, contentWidth, 54).fill('#0F172A'); // Dark slate Neo-Brutalism header

    doc.font(boldFont).fontSize(10).fillColor('#38BDF8')
      .text('ZALOCRM  •  HỆ THỐNG ĐIỀU HÀNH & BÁO CÁO TỔNG HỢP', 48, 46, { width: contentWidth - 24 });

    const cleanTitle = cleanText(reportTitle) || 'Báo Cáo Điều Hành Tổng Hợp';
    doc.font(boldFont).fontSize(14).fillColor('#FFFFFF')
      .text(cleanTitle, 48, 62, { width: contentWidth - 24 });

    // ── 2. METADATA BAR ───────────────────────────────────────────────
    const nowStr = new Date().toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });

    // Safe regex: supports bold Markdown `**Thời gian:**` and guards against "báo cáo:" contamination
    const safePdfTimeRegex = /(?:^\s*[*_~-]*\s*Thời gian(?:\s*báo\s*cáo)?\s*[*_~-]*\s*:\s*[*_~-]*\s*)([^\n|*]+)(?:\|\s*([^\n*]+))?/imu;
    const timeScopeMatch = markdownContent.match(safePdfTimeRegex);
    const rawPeriodFromRegex = timeScopeMatch ? cleanText(timeScopeMatch[1]) : '';
    const isBadPdfTime = /^(báo cáo|thời gian báo cáo)[:\s]*$/i.test(rawPeriodFromRegex.trim()) || rawPeriodFromRegex.trim() === '';
    const periodText = options.periodText || (isBadPdfTime ? '' : rawPeriodFromRegex);
    const scopeText = options.scopeText || (timeScopeMatch && timeScopeMatch[2] ? cleanText(timeScopeMatch[2].replace(/\*+$/, '')) : '');

    const metadataY = 96;
    doc.rect(36, metadataY, contentWidth, 22).fill('#F1F5F9');
    doc.font(regularFont).fontSize(8.5).fillColor('#475569')
      .text(`⏰ Thời gian: ${periodText || 'N/A'}    |    👥 ${scopeText || 'Toàn hệ thống'}    |    📅 Ngày xuất: ${nowStr}`, 46, metadataY + 6, { width: contentWidth - 20 });

    doc.y = metadataY + 30;

    // ── 3. ROBUST MARKDOWN DOCUMENT RENDERING ──────────────────────────
    let currentTable: string[][] | null = null;

    const flushTable = () => {
      if (!currentTable || currentTable.length === 0) {
        currentTable = null;
        return;
      }
      const rows = currentTable;
      currentTable = null;
      if (rows.length < 2) return;

      const headers = rows[0];
      const dataRows = rows.slice(1);
      const isAction = isActionItemsTable(headers);
      const headerH = 22;
      const padV = 5;
      const MAX_ROW_H = pageHeight - 110;

      const clampCellText = (text: string, textWidth: number): { text: string; height: number } => {
        doc.font(regularFont).fontSize(8.5);
        const fullH = doc.heightOfString(text, { width: textWidth });
        const maxAllowedH = MAX_ROW_H - padV * 2;
        if (fullH <= maxAllowedH) {
          return { text, height: fullH };
        }
        let low = 0;
        let high = text.length;
        let bestText = text.slice(0, 500);
        let bestH = doc.heightOfString(bestText + ' [...]', { width: textWidth });
        while (low <= high) {
          const mid = Math.floor((low + high) / 2);
          const candidate = text.slice(0, mid) + ' [...]';
          const h = doc.heightOfString(candidate, { width: textWidth });
          if (h <= maxAllowedH) {
            bestText = candidate;
            bestH = h;
            low = mid + 1;
          } else {
            high = mid - 1;
          }
        }
        return { text: bestText, height: bestH };
      };

      if (isAction) {
        const colStt = { x: 36, w: 28 };
        const colTask = { x: 64, w: 270 };
        const colAssignee = { x: 334, w: 95 };
        const colDeadline = { x: 429, w: 70 };
        const colPriority = { x: 499, w: 60 };

        const sttTextWidth = colStt.w - 4; // 24pt
        const taskTextWidth = colTask.w - 12; // 258pt
        const assigneeTextWidth = colAssignee.w - 8; // 87pt
        const deadlineTextWidth = colDeadline.w - 8; // 62pt
        const priorityTextWidth = colPriority.w - 4; // 56pt

        const hasExplicitSttCol = headers.length >= 5 || (headers.length > 0 && /#|stt|no/i.test(headers[0]));

        const renderActionTableHeader = (): void => {
          const headerY = doc.y;
          doc.rect(36, headerY, contentWidth, headerH).fill('#1E293B');
          doc.font(boldFont).fontSize(8.5).fillColor('#FFFFFF');
          doc.text('#', colStt.x + 2, headerY + 6, { width: sttTextWidth, align: 'center' });
          doc.text('Hành động', colTask.x + 6, headerY + 6, { width: taskTextWidth });
          doc.text('Người phụ trách', colAssignee.x + 4, headerY + 6, { width: assigneeTextWidth });
          doc.text('Thời hạn', colDeadline.x + 4, headerY + 6, { width: deadlineTextWidth });
          doc.text('Ưu tiên', colPriority.x + 2, headerY + 6, { width: priorityTextWidth, align: 'center' });
          doc.y = headerY + headerH;
        };

        const parseActionRow = (row: string[], idx: number) => {
          let stt = '';
          let task = '';
          let assignee = '';
          let deadline = '';
          let priority = '';

          if (!hasExplicitSttCol) {
            stt = String(idx + 1);
            if (row.length <= 4) {
              task = row[0] || '';
              assignee = row[1] || '';
              deadline = row[2] || '';
              priority = row[3] || '';
            } else {
              task = row.slice(0, row.length - 3).join(' | ');
              assignee = row[row.length - 3] || '';
              deadline = row[row.length - 2] || '';
              priority = row[row.length - 1] || '';
            }
          } else {
            stt = row[0] || String(idx + 1);
            if (row.length <= 5) {
              task = row[1] || '';
              assignee = row[2] || '';
              deadline = row[3] || '';
              priority = row[4] || '';
            } else {
              task = row.slice(1, row.length - 3).join(' | ');
              assignee = row[row.length - 3] || '';
              deadline = row[row.length - 2] || '';
              priority = row[row.length - 1] || '';
            }
          }

          stt = stt || String(idx + 1);
          assignee = assignee || 'Chưa phân công';
          deadline = deadline || 'Trong ca';
          priority = priority || 'medium';

          return { stt, task, assignee, deadline, priority };
        };

        const computeActionRow = (row: string[], idx: number) => {
          const parsed = parseActionRow(row, idx);
          const taskData = clampCellText(parsed.task, taskTextWidth);
          const assigneeData = clampCellText(parsed.assignee, assigneeTextWidth);
          const deadlineData = clampCellText(parsed.deadline, deadlineTextWidth);

          const rawRowH = Math.max(22, taskData.height + padV * 2, assigneeData.height + padV * 2, deadlineData.height + padV * 2);
          const rowH = Math.min(rawRowH, MAX_ROW_H);

          const pRaw = parsed.priority.toLowerCase();
          const pColor = pRaw.includes('cao') || pRaw.includes('high') ? '#DC2626' : pRaw.includes('thấp') || pRaw.includes('low') ? '#16A34A' : '#D97706';
          const pLabel = pRaw.includes('cao') || pRaw.includes('high') ? 'Cao' : pRaw.includes('thấp') || pRaw.includes('low') ? 'Thấp' : 'T.Bình';

          return {
            stt: parsed.stt,
            task: taskData.text,
            assignee: assigneeData.text,
            deadline: deadlineData.text,
            pColor,
            pLabel,
            rowH,
          };
        };

        // Check orphan header before drawing table
        if (dataRows.length > 0) {
          const firstRow = computeActionRow(dataRows[0], 0);
          if (doc.y + headerH + firstRow.rowH > pageHeight - 50) {
            doc.addPage();
          }
        }
        renderActionTableHeader();

        dataRows.forEach((row, idx) => {
          const rowData = computeActionRow(row, idx);
          if (doc.y + rowData.rowH > pageHeight - 50) {
            doc.addPage();
            renderActionTableHeader();
          }

          const rowStartY = doc.y;
          const isEven = idx % 2 === 0;

          doc.rect(36, rowStartY, contentWidth, rowData.rowH).fill(isEven ? '#F8FAFC' : '#FFFFFF');
          doc.rect(36, rowStartY, contentWidth, rowData.rowH).stroke('#E2E8F0');

          doc.font(regularFont).fontSize(8.5).fillColor('#0F172A');
          doc.text(rowData.stt, colStt.x + 2, rowStartY + padV, { width: sttTextWidth, align: 'center' });
          doc.text(rowData.task, colTask.x + 6, rowStartY + padV, { width: taskTextWidth });
          doc.text(rowData.assignee, colAssignee.x + 4, rowStartY + padV, { width: assigneeTextWidth });
          doc.text(rowData.deadline, colDeadline.x + 4, rowStartY + padV, { width: deadlineTextWidth });

          doc.font(boldFont).fontSize(8).fillColor(rowData.pColor);
          doc.text(rowData.pLabel, colPriority.x + 2, rowStartY + padV, { width: priorityTextWidth, align: 'center' });

          doc.y = rowStartY + rowData.rowH;
        });
        doc.y += 10;
      } else {
        // Generic table
        const colCount = Math.max(1, headers.length);
        const colW = contentWidth / colCount;

        const renderGenericHeader = (): void => {
          const headerY = doc.y;
          doc.rect(36, headerY, contentWidth, headerH).fill('#1E293B');
          doc.font(boldFont).fontSize(8.5).fillColor('#FFFFFF');
          headers.forEach((h, cIdx) => {
            doc.text(h, 36 + cIdx * colW + 4, headerY + 6, { width: colW - 8 });
          });
          doc.y = headerY + headerH;
        };

        const computeGenericRow = (row: string[]) => {
          let maxCellH = 0;
          const processedCells = row.map((cell) => {
            const cellData = clampCellText(cell || '', colW - 8);
            if (cellData.height > maxCellH) {
              maxCellH = cellData.height;
            }
            return cellData.text;
          });
          const rawRowH = Math.max(22, maxCellH + padV * 2);
          const rowH = Math.min(rawRowH, MAX_ROW_H);
          return { cells: processedCells, rowH };
        };

        if (dataRows.length > 0) {
          const firstRow = computeGenericRow(dataRows[0]);
          if (doc.y + headerH + firstRow.rowH > pageHeight - 50) {
            doc.addPage();
          }
        }
        renderGenericHeader();

        dataRows.forEach((row, idx) => {
          const rowData = computeGenericRow(row);
          if (doc.y + rowData.rowH > pageHeight - 50) {
            doc.addPage();
            renderGenericHeader();
          }

          const rowStartY = doc.y;
          doc.rect(36, rowStartY, contentWidth, rowData.rowH).fill(idx % 2 === 0 ? '#F8FAFC' : '#FFFFFF');
          doc.rect(36, rowStartY, contentWidth, rowData.rowH).stroke('#E2E8F0');

          doc.font(regularFont).fontSize(8.5).fillColor('#0F172A');
          rowData.cells.forEach((cell, cIdx) => {
            if (cIdx < colCount) {
              doc.text(cell, 36 + cIdx * colW + 4, rowStartY + padV, { width: colW - 8 });
            }
          });
          doc.y = rowStartY + rowData.rowH;
        });
        doc.y += 10;
      }
    };

    const lines = markdownContent.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const trimmed = rawLine.trim();
      if (!trimmed) {
        flushTable();
        continue;
      }

      // Check table row
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        if (/^\|[\s\-:|]+\|$/.test(trimmed)) continue; // skip markdown table separator
        const escapedPlaceholder = '__ESCAPED_PIPE__';
        const safeLine = trimmed.slice(1, -1).replace(/\\\|/g, escapedPlaceholder);
        const cells = safeLine.split('|').map((c) => cleanText(c.replace(new RegExp(escapedPlaceholder, 'g'), '|')));
        if (!currentTable) currentTable = [];
        currentTable.push(cells);
        continue;
      } else {
        flushTable();
      }

      // Skip document top title (already rendered in header banner)
      if (/^#\s+/.test(trimmed)) continue;

      // Skip metadata time line (already rendered in metadata bar)
      if (/^(?:\*|_){1,2}Thời gian:.*(?:\*|_){1,2}$/iu.test(trimmed)) continue;

      // Horizontal rule / divider
      if (/^(?:---+|\*\*\*+|___+)$/.test(trimmed)) {
        if (doc.y < pageHeight - 50) {
          doc.rect(36, doc.y + 4, contentWidth, 0.5).fill('#E2E8F0');
          doc.y += 10;
        }
        continue;
      }

      // Heading (##, ###, ####)
      const headingMatch = trimmed.match(/^(#{2,4})\s+(.+)$/);
      if (headingMatch) {
        if (doc.y > pageHeight - 80) doc.addPage();
        const level = headingMatch[1].length;
        const text = cleanText(headingMatch[2]);
        const color = getSectionColor(text);
        doc.rect(36, doc.y, 4, 16).fill(color);
        doc.font(boldFont).fontSize(level === 2 ? 11 : 10).fillColor('#0F172A')
          .text(text, 46, doc.y + 1, { width: contentWidth - 10 });
        doc.y += 8;
        continue;
      }

      // Bullet item
      const bulletMatch = trimmed.match(/^([-*+•]|\d+[\.\)])\s+(.+)$/);
      if (bulletMatch) {
        if (doc.y > pageHeight - 50) doc.addPage();
        const isIndented = rawLine.startsWith('  ') || rawLine.startsWith('\t');
        const text = cleanText(bulletMatch[2]);
        const indent = isIndented ? 56 : 44;
        doc.font(regularFont).fontSize(9).fillColor('#334155')
          .text('•', indent - 8, doc.y, { continued: true })
          .text(`  ${text}`, indent, doc.y, { width: contentWidth - indent + 36, lineGap: 2 });
        doc.y += 3;
        continue;
      }

      // Blockquote
      if (trimmed.startsWith('>')) {
        if (doc.y > pageHeight - 50) doc.addPage();
        const text = cleanText(trimmed.replace(/^>\s*/, ''));
        doc.rect(36, doc.y, 3, 14).fill('#94A3B8');
        doc.font(regularFont).fontSize(9).fillColor('#475569')
          .text(text, 44, doc.y, { width: contentWidth - 16, lineGap: 2 });
        doc.y += 4;
        continue;
      }

      // Regular paragraph / text
      if (doc.y > pageHeight - 50) doc.addPage();
      const text = cleanText(trimmed);
      if (text) {
        doc.font(regularFont).fontSize(9).fillColor('#334155')
          .text(text, 44, doc.y, { width: contentWidth - 16, lineGap: 2 });
        doc.y += 4;
      }
    }
    flushTable();

    // ── 4. PAGE NUMBERING FOOTER ─────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Temporarily set margins.bottom to 0 so footer text never triggers an auto-page-break
      doc.page.margins.bottom = 0;
      doc.rect(36, pageHeight - 32, contentWidth, 0.5).fill('#CBD5E1');
      doc.font(regularFont).fontSize(8).fillColor('#64748B')
        .text('ZaloCRM AI Operations Engine  •  Bản quyền thuộc về Zalo Sales CRM', 36, pageHeight - 24, { width: contentWidth / 2, lineBreak: false });
      doc.font(regularFont).fontSize(8).fillColor('#64748B')
        .text(`Trang ${i + 1} / ${range.count}`, pageWidth - 36 - contentWidth / 2, pageHeight - 24, { width: contentWidth / 2, align: 'right', lineBreak: false });
    }

    doc.end();
  });
}

/**
 * Generate PDF and save to a temporary file on disk for attachment dispatch.
 */
export async function generateReportPdfFile(
  reportTitle: string,
  markdownContent: string,
  options: GeneratePdfOptions = {},
): Promise<GeneratedPdfFile> {
  const buffer = await generateReportPdfBuffer(reportTitle, markdownContent, options);

  // Clean filename for Zalo file attachment
  const dateSlug = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const cleanTitleSlug = reportTitle
    .toLowerCase()
    .replace(/[đ]/g, 'd')
    .replace(/[Đ]/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30) || 'bao-cao-dieu-hanh';

  const filename = `${cleanTitleSlug}-${dateSlug}.pdf`;
  const tmpDir = path.join(os.tmpdir(), 'zalocrm-reports');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const filePath = path.join(tmpDir, `${Date.now()}-${filename}`);
  await fs.promises.writeFile(filePath, buffer);

  const cleanup = async () => {
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch {
      // ignore cleanup errors
    }
  };

  return { filePath, filename, cleanup };
}
