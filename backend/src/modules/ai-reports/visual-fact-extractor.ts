/**
 * visual-fact-extractor.ts — Independent Two-Step Visual Fact Extractor.
 * Extracts objective visual facts into strict JSON without employee chat text to eliminate confirmation bias.
 */
import { logger } from '../../shared/utils/logger.js';
import { isReportControlError, runReportExecutionGuard, type ReportJobBudget } from './report-job-budget.js';
import { generateContent } from './ai-client.js';
import type { ContentPart } from './providers/ai-provider-interface.js';
import {
  type LoadedPhotoCandidate,
  type VerifiedVisualFact,
  createDefaultFallbackFact,
} from './visual-fact-types.js';
import { globalVisualFactCache, type VisualFactCache } from './visual-fact-cache.js';

export interface ExtractVisualFactsOptions {
  budget: ReportJobBudget;
  executionGuard: () => Promise<void>;
  orgId?: string;
  signal?: AbortSignal;
  cache?: VisualFactCache;
}

/**
 * Sanitizes visual text extracted via OCR to prevent Prompt Injection and Markdown breakout:
 * - Strips brackets [ and ]
 * - Strips table pipe character |
 * - Strips newlines, carriage returns, tabs
 * - Collapses consecutive whitespace and truncates length
 */
export function sanitizeVisualText(text: string | null | undefined, maxLen = 200): string {
  if (!text || typeof text !== 'string') return '';
  let cleaned = text.replace(/[\r\n\t]+/g, ' ');
  cleaned = cleaned.replace(/[\[\]\|]/g, '');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  if (cleaned.length > maxLen) {
    cleaned = cleaned.slice(0, maxLen - 3) + '...';
  }
  return cleaned;
}

const SINGLE_IMAGE_EXTRACTION_PROMPT = `Bạn là chuyên gia phân tích ảnh và trích xuất sự thật khách quan (Visual Fact Extractor).
Nhiệm vụ: Hãy quan sát kỹ bức ảnh được cung cấp và trích xuất dữ liệu trung thực dưới dạng JSON thuần túy (không dùng markdown giải thích).
TUYỆT ĐỐI KHÔNG giả định, KHÔNG phỏng đoán hoặc suy diễn những gì không nhìn thấy rõ trong ảnh.

ĐẶC BIỆT CHÚ Ý VỀ THIẾT BỊ CÂN ĐO:
- Chỉ ghi nhận "hasScale": true nếu THỰC SỰ NHÌN THẤY rõ ràng chiếc cân hoặc màn hình đo lường trọng lượng trong ảnh.
- Nếu ảnh chỉ chụp hiện vật (chai lọ, cốc, khay hoa quả, bàn ghế, túi...), TUYỆT ĐỐI ghi:
  "measuringDevice": { "hasScale": false, "scaleReading": null, "unit": null }
- CẤM BỊA RA CHIẾC CÂN HOẶC SỐ ĐO TRỌNG LƯỢNG KHÔNG CÓ TRÊN ẢNH.

HÃY TRẢ VỀ DUY NHẤT MỘT KHỐI JSON CÓ CẤU TRÚC SAU:
{
  "objects": ["tên các vật thể nhìn thấy"],
  "visualCondition": "mô tả tình trạng hiện vật, bao bì, màu sắc, độ tươi, nguyên vẹn hay hư hại",
  "measuringDevice": {
    "hasScale": false,
    "scaleReading": null,
    "unit": null
  },
  "textLabels": [
    { "type": "watermark", "content": "chữ trên ảnh nếu có" }
  ],
  "evidenceSummary": "tóm tắt khách quan những gì thực sự nhìn thấy trong ảnh"
}`;

/**
 * Extracts visual facts for a single image with caching and fail-closed error handling.
 */
export async function extractSingleVisualFact(
  candidate: LoadedPhotoCandidate,
  photoIndex: number,
  options: ExtractVisualFactsOptions,
): Promise<VerifiedVisualFact> {
  await runReportExecutionGuard(options.executionGuard);
  if (options.signal?.aborted) {
    throw new Error('Fact extraction aborted by signal');
  }

  const cache = options.cache || globalVisualFactCache;
  const cached = cache.get(options.orgId, candidate.buffer);
  if (cached) {
    return {
      ...cached,
      photoIndex,
      senderId: candidate.candidate.senderId,
      senderName: candidate.candidate.senderName,
      sentAtMs: candidate.candidate.sentAtMs,
    };
  }

  try {
    const promptParts: ContentPart[] = [
      candidate.part,
      { text: SINGLE_IMAGE_EXTRACTION_PROMPT },
    ];

    const rawResponse = await generateContent(promptParts, {
      budget: options.budget,
      executionGuard: options.executionGuard,
      orgId: options.orgId,
      signal: options.signal,
      taskType: 'vision_fact_extraction',
      temperature: 0.1,
      maxOutputTokens: 2048,
      systemInstruction: 'Bạn là chuyên gia trích xuất sự thật thị giác khách quan, luôn trả về JSON hợp lệ.',
    });

    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('AI response did not contain a valid JSON block');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const hasScale = Boolean(parsed.measuringDevice?.hasScale);
    const rawReading = hasScale ? sanitizeVisualText(parsed.measuringDevice?.scaleReading, 50) : null;
    const rawUnit = hasScale ? sanitizeVisualText(parsed.measuringDevice?.unit, 20) : null;

    const fact: VerifiedVisualFact = {
      photoIndex,
      hasVisualEvidence: true,
      photoUrl: candidate.candidate.url,
      localPath: candidate.candidate.localPath,
      senderId: candidate.candidate.senderId,
      senderName: candidate.candidate.senderName,
      sentAtMs: candidate.candidate.sentAtMs,
      objects: Array.isArray(parsed.objects)
        ? parsed.objects.map((o: any) => sanitizeVisualText(String(o), 100)).filter(Boolean)
        : [],
      visualCondition: sanitizeVisualText(parsed.visualCondition || 'Bình thường', 200),
      measuringDevice: {
        hasScale,
        scaleReading: hasScale && rawReading ? rawReading : null,
        unit: hasScale && rawUnit ? rawUnit : null,
      },
      textLabels: Array.isArray(parsed.textLabels)
        ? parsed.textLabels
            .map((lbl: any) => ({
              type: ['watermark', 'receipt', 'label', 'other'].includes(lbl?.type) ? lbl.type : 'other',
              content: sanitizeVisualText(String(lbl?.content || ''), 150),
            }))
            .filter((lbl: any) => Boolean(lbl.content))
        : [],
      evidenceSummary: sanitizeVisualText(parsed.evidenceSummary || 'Đã ghi nhận hiện vật trong ảnh', 300),
    };

    cache.set(options.orgId, candidate.buffer, fact);
    return fact;
  } catch (err: any) {
    if (isReportControlError(err) || options.signal?.aborted) {
      throw err;
    }
    logger.warn(`[visual-fact-extractor] Failed to extract facts for photo #${photoIndex}: ${err?.message || err}`);
    return createDefaultFallbackFact(photoIndex, candidate.candidate, err?.message);
  }
}

/**
 * Formats verified facts into safe XML tags for inclusion into prompts.
 */
export function formatVerifiedFactsForPrompt(facts: VerifiedVisualFact[]): string {
  if (!facts || facts.length === 0) return '';

  const formattedItems = facts.map((fact, idx) => {
    const timeStr = fact.sentAtMs
      ? new Date(fact.sentAtMs).toLocaleString('vi-VN', {
          timeZone: 'Asia/Ho_Chi_Minh',
          hour: '2-digit',
          minute: '2-digit',
          day: '2-digit',
          month: '2-digit',
        })
      : 'Không rõ';
    const sender = fact.senderName || fact.senderId || 'Nhân viên';

    if (!fact.hasVisualEvidence) {
      return `[Ảnh ${idx + 1}] Người gửi: ${sender} | Thời gian: ${timeStr}
  • Trạng thái: Không thể giải mã chi tiết ảnh do sự cố kỹ thuật.
  • Ghi chú: ${fact.evidenceSummary}`;
    }

    const scaleInfo = fact.measuringDevice.hasScale
      ? `CÓ CÂN - Số đo: ${fact.measuringDevice.scaleReading || 'Không rõ'} ${fact.measuringDevice.unit || ''}`.trim()
      : 'KHÔNG CÓ CÂN, KHÔNG CÓ MÀN HÌNH ĐO';

    const labelsInfo = fact.textLabels.length > 0
      ? fact.textLabels.map((l) => `"${l.content}" (${l.type})`).join(', ')
      : 'Không phát hiện';

    return `[Ảnh ${idx + 1}] Người gửi: ${sender} | Thời gian: ${timeStr}
  • Hiện vật ghi nhận: ${fact.objects.join(', ') || 'Hiện vật không xác định'}
  • Tình trạng thị giác: ${fact.visualCondition}
  • Thiết bị cân đo: ${scaleInfo}
  • Nhãn & Ký tự trên ảnh: ${labelsInfo}
  • Ghi chú: ${fact.evidenceSummary}`;
  });

  return `<verified_visual_evidence total="${facts.length}">\n${formattedItems.join('\n\n')}\n</verified_visual_evidence>`;
}

/**
 * Extracts visual facts from a list of loaded candidates using a worker pool (concurrency: 2).
 */
export async function extractVisualFacts(
  candidates: LoadedPhotoCandidate[],
  options: ExtractVisualFactsOptions,
): Promise<VerifiedVisualFact[]> {
  if (!candidates || candidates.length === 0) {
    return [];
  }

  const results: VerifiedVisualFact[] = new Array(candidates.length);
  const CONCURRENCY = 2;
  let currentIndex = 0;

  const workers = Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, async () => {
    while (currentIndex < candidates.length) {
      const idx = currentIndex++;
      results[idx] = await extractSingleVisualFact(candidates[idx], idx + 1, options);
    }
  });

  await Promise.all(workers);
  return results;
}
