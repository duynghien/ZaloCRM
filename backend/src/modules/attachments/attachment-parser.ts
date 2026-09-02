/**
 * attachment-parser.ts — Multi-format parser engine for PDF, Excel, and Image documents.
 * Extracts text, tables, and structured data for AI summarization.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
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
const MAX_PARSE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_PAGES = 100;
const MAX_SHEETS = 20;
const MAX_ROWS = 2_000;
const MAX_CELLS = 20_000;
const PARSE_TIMEOUT_MS = 20_000;
const MAX_CONCURRENT_PARSES = 2;
const MAX_QUEUED_PARSES = 20;
let activeParses = 0;
const parseWaiters: Array<() => void> = [];

class ParserLimitError extends Error {}

async function acquireParseWorker(): Promise<void> {
  if (activeParses < MAX_CONCURRENT_PARSES && parseWaiters.length === 0) {
    activeParses++;
    return;
  }
  if (parseWaiters.length >= MAX_QUEUED_PARSES) {
    throw new ParserLimitError('Attachment parser queue is full');
  }

  await new Promise<void>((resolve) => parseWaiters.push(resolve));
}

function releaseParseWorker(): void {
  const next = parseWaiters.shift();
  if (next) {
    next();
    return;
  }
  activeParses--;
}

async function readBounded(source: Buffer | string): Promise<Buffer> {
  const buffer = typeof source === 'string' ? await fs.promises.readFile(source) : source;
  if (buffer.length > MAX_PARSE_BYTES) throw new ParserLimitError('Attachment exceeds parser byte limit');
  return buffer;
}

/**
 * Parse PDF content using pdf-parse with scanned PDF fallback detection.
 */
async function parsePdf(source: Buffer | string): Promise<PdfParseResult> {
  try {
    const buffer = await readBounded(source);
    const data = await pdfParse(buffer);
    if ((data.numpages || 0) > MAX_PDF_PAGES) throw new ParserLimitError('PDF exceeds page limit');
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
async function parseExcel(source: Buffer | string): Promise<ExcelParseResult> {
  try {
    const input = await readBounded(source);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(input as any);

    const sheetSummaries: string[] = [];
    const sheetNames: string[] = [];
    let totalProcessedRows = 0;

    if (workbook.worksheets.length > MAX_SHEETS) throw new ParserLimitError('Workbook exceeds sheet limit');
    let totalCells = 0;
    workbook.eachSheet((worksheet) => {
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
        if (rowNumber > MAX_ROWS || totalProcessedRows >= MAX_ROWS) return;
        if (rowNumber === 1) return; // Skip header row already captured
        rowCount++;
        totalProcessedRows++;

        const rowValues: string[] = [];
        let hasContent = false;
        let isSummaryRow = false;

        row.eachCell({ includeEmpty: false }, (cell) => {
          totalCells++;
          if (totalCells > MAX_CELLS) throw new ParserLimitError('Workbook exceeds cell limit');
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
async function prepareImageBuffer(
  source: Buffer | string,
  providedMimeType?: string,
): Promise<ImagePrepResult | null> {
  try {
    const buffer = await readBounded(source);
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
export interface AttachmentParseParams {
  filename?: string;
  mimeType?: string;
  localPath?: string;
  buffer?: Buffer;
}

/** Runs inside the parser process, where a hard timeout can reclaim memory and CPU. */
export async function extractAttachmentContentInWorker(params: AttachmentParseParams): Promise<ExtractedContentResult> {
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

/**
 * Extract attachment content in an isolated process. The pool queues excess work,
 * while a timed-out process is hard-terminated before its slot is released.
 */
export async function extractAttachmentContent(params: AttachmentParseParams): Promise<ExtractedContentResult> {
  await acquireParseWorker();

  return new Promise<ExtractedContentResult>((resolve, reject) => {
    let child;
    try {
      child = fork(new URL('./attachment-parser-worker.js', import.meta.url), [], {
        serialization: 'advanced',
      });
    } catch (spawnError) {
      releaseParseWorker();
      reject(spawnError instanceof Error ? spawnError : new Error('Attachment parser process failed to start'));
      return;
    }
    let settled = false;
    let result: ExtractedContentResult | undefined;
    let error: Error | undefined;
    const timeout = setTimeout(() => {
      finish(new ParserLimitError('Attachment parse timed out'), 'SIGKILL');
    }, PARSE_TIMEOUT_MS);

    const finish = (nextError?: Error, signal: NodeJS.Signals = 'SIGTERM', nextResult?: ExtractedContentResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      error = nextError;
      result = nextResult;
      child.kill(signal);
    };

    child.once('message', (message: { result?: ExtractedContentResult; error?: string }) => {
      finish(message.error ? new Error(message.error) : undefined, 'SIGTERM', message.result);
    });
    child.once('error', (childError) => finish(childError instanceof Error ? childError : new Error('Attachment parser process failed'), 'SIGKILL'));
    child.once('exit', (code, signal) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        error = new Error(`Attachment parser process exited unexpectedly (${code ?? signal ?? 'unknown'})`);
      }
      releaseParseWorker();
      if (error) reject(error);
      else resolve(result!);
    });
    try {
      child.send(params, (sendError) => {
        if (sendError) finish(sendError, 'SIGKILL');
      });
    } catch (sendError) {
      finish(sendError instanceof Error ? sendError : new Error('Attachment parser process did not accept work'), 'SIGKILL');
    }
  });
}
