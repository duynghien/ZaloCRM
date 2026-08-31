/**
 * attachment-parser.ts — Multi-format parser engine for PDF, Excel, and Image documents.
 * Extracts text, tables, and structured data for AI summarization.
 */
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import pdfParse from 'pdf-parse';
import { logger } from '../../shared/utils/logger.js';

export interface PdfParseResult {
  text: string;
  pageCount: number;
  isScanned: boolean;
}

export interface ExcelParseResult {
  text: string;
  sheetNames: string[];
  totalRows: number;
}

export interface ImagePrepResult {
  mimeType: string;
  base64Data: string;
  sizeBytes: number;
}

export interface ExtractedContentResult {
  type: 'pdf' | 'excel' | 'image' | 'text' | 'unknown';
  text: string;
  isScanned?: boolean;
  pageCount?: number;
  sheetNames?: string[];
  imagePrep?: ImagePrepResult;
}

const SUMMARY_KEYWORDS = [
  'tổng',
  'total',
  'doanh số',
  'doanh thu',
  'kpi',
  'thành tiền',
  'cộng',
  'summary',
  'kết quả',
  'chi phí',
  'lợi nhuận',
  'công nợ',
  'tồn kho',
  'tiến độ',
];

/**
 * Parse PDF content using pdf-parse with scanned PDF fallback detection.
 */
export async function parsePdf(source: Buffer | string): Promise<PdfParseResult> {
  try {
    const buffer = typeof source === 'string' ? await fs.promises.readFile(source) : source;
    const data = await pdfParse(buffer);
    const rawText = (data.text || '').trim();
    const isScanned = rawText.length < 50;

    return {
      text: rawText,
      pageCount: data.numpages || 1,
      isScanned,
    };
  } catch (err: any) {
    logger.error('[attachment-parser] PDF parse error:', err?.message || err);
    return {
      text: '',
      pageCount: 0,
      isScanned: true,
    };
  }
}

/**
 * Parse Excel (.xlsx/.xls) sheets with row capping and summary row preservation.
 */
export async function parseExcel(source: Buffer | string): Promise<ExcelParseResult> {
  try {
    const workbook = new ExcelJS.Workbook();
    if (typeof source === 'string') {
      await workbook.xlsx.readFile(source);
    } else {
      await workbook.xlsx.load(source as any);
    }

    const sheetSummaries: string[] = [];
    const sheetNames: string[] = [];
    let totalProcessedRows = 0;

    workbook.eachSheet((worksheet, sheetId) => {
      sheetNames.push(worksheet.name);
      const rowsText: string[] = [];
      const headerRow = worksheet.getRow(1);
      const headers: string[] = [];

      headerRow.eachCell({ includeEmpty: false }, (cell) => {
        headers.push(String(cell.text || cell.value || '').trim());
      });

      if (headers.length > 0) {
        rowsText.push(`| ${headers.join(' | ')} |`);
        rowsText.push(`| ${headers.map(() => '---').join(' | ')} |`);
      }

      let rowCount = 0;
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // Skip header row already captured
        rowCount++;
        totalProcessedRows++;

        const rowValues: string[] = [];
        let hasContent = false;
        let isSummaryRow = false;

        row.eachCell({ includeEmpty: false }, (cell) => {
          const val = String(cell.text || cell.value || '').trim();
          if (val) {
            hasContent = true;
            rowValues.push(val);
            const lower = val.toLowerCase();
            if (SUMMARY_KEYWORDS.some((kw) => lower.includes(kw))) {
              isSummaryRow = true;
            }
          }
        });

        if (!hasContent) return;

        // Keep first 100 rows OR rows that match summary keywords
        if (rowNumber <= 100 || isSummaryRow) {
          rowsText.push(`| ${rowValues.join(' | ')} |`);
        }
      });

      if (rowCount > 100) {
        rowsText.push(`*(Sheet "${worksheet.name}" có ${rowCount} dòng, đã trích xuất 100 dòng đầu + các dòng tổng kết)*`);
      }

      sheetSummaries.push(`### Sheet: ${worksheet.name}\n${rowsText.join('\n')}`);
    });

    return {
      text: sheetSummaries.join('\n\n'),
      sheetNames,
      totalRows: totalProcessedRows,
    };
  } catch (err: any) {
    logger.error('[attachment-parser] Excel parse error:', err?.message || err);
    return {
      text: '',
      sheetNames: [],
      totalRows: 0,
    };
  }
}

/**
 * Prepare image buffer as base64 for Gemini Multimodal / OCR.
 */
export async function prepareImageBuffer(
  source: Buffer | string,
  providedMimeType?: string,
): Promise<ImagePrepResult | null> {
  try {
    const buffer = typeof source === 'string' ? await fs.promises.readFile(source) : source;
    let mimeType = providedMimeType || 'image/jpeg';

    if (typeof source === 'string') {
      const ext = path.extname(source).toLowerCase();
      if (ext === '.png') mimeType = 'image/png';
      else if (ext === '.webp') mimeType = 'image/webp';
      else if (ext === '.gif') mimeType = 'image/gif';
    }

    return {
      mimeType,
      base64Data: buffer.toString('base64'),
      sizeBytes: buffer.length,
    };
  } catch (err: any) {
    logger.error('[attachment-parser] Image prep error:', err?.message || err);
    return null;
  }
}

/**
 * Universal content extractor for attachments.
 */
export async function extractAttachmentContent(params: {
  filename?: string;
  mimeType?: string;
  localPath?: string;
  buffer?: Buffer;
}): Promise<ExtractedContentResult> {
  const filename = (params.filename || '').toLowerCase();
  const mime = (params.mimeType || '').toLowerCase();

  const isPdf = filename.endsWith('.pdf') || mime.includes('pdf');
  const isExcel =
    filename.endsWith('.xlsx') ||
    filename.endsWith('.xls') ||
    filename.endsWith('.csv') ||
    mime.includes('spreadsheet') ||
    mime.includes('excel');
  const isImage =
    filename.endsWith('.jpg') ||
    filename.endsWith('.jpeg') ||
    filename.endsWith('.png') ||
    filename.endsWith('.webp') ||
    mime.includes('image/');

  if (isPdf) {
    const src = params.buffer || params.localPath;
    if (!src) return { type: 'pdf', text: '' };
    const pdfRes = await parsePdf(src);
    return {
      type: 'pdf',
      text: pdfRes.text,
      isScanned: pdfRes.isScanned,
      pageCount: pdfRes.pageCount,
    };
  }

  if (isExcel) {
    const src = params.buffer || params.localPath;
    if (!src) return { type: 'excel', text: '' };
    const excelRes = await parseExcel(src);
    return {
      type: 'excel',
      text: excelRes.text,
      sheetNames: excelRes.sheetNames,
    };
  }

  if (isImage) {
    const src = params.buffer || params.localPath;
    if (!src) return { type: 'image', text: '' };
    const imgRes = await prepareImageBuffer(src, params.mimeType);
    return {
      type: 'image',
      text: '[Ảnh đính kèm]',
      imagePrep: imgRes || undefined,
    };
  }

  return {
    type: 'unknown',
    text: '',
  };
}
