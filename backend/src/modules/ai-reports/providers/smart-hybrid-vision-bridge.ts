/**
 * smart-hybrid-vision-bridge.ts — Hybrid multimodal OCR bridge and graceful degradation for text-only AI models.
 */
import { logger } from '../../../shared/utils/logger.js';
import type { AiProvider, ContentPart, GenerateOptions } from './ai-provider-interface.js';

const MISSING_VISION_NOTICE = '[Hình ảnh không được phân tích do thiếu Vision Provider]';
const VISION_FAIL_NOTICE = '[Không thể giải mã ảnh do sự cố Vision Bridge]';

/**
 * Preprocess a multimodal prompt for a provider. If the target provider doesn't support vision,
 * extracts visual content via an available vision provider (Gemini or OpenAI), or degrades gracefully.
 */
export async function preprocessMultimodalPrompt(
  prompt: string | ContentPart[],
  targetProvider: AiProvider,
  visionProvider: AiProvider | null,
  options: GenerateOptions,
): Promise<string | ContentPart[]> {
  // If target provider already supports vision, or prompt is a pure string, no preprocessing needed
  if (targetProvider.supportsVision || typeof prompt === 'string') {
    return prompt;
  }

  const hasImages = prompt.some((part) => Boolean(part.inlineData));
  if (!hasImages) {
    return prompt;
  }

  logger.info(`[vision-bridge] Target provider ${targetProvider.type} is text-only. Preprocessing ${prompt.length} parts...`);

  const processedParts: ContentPart[] = [];
  // Isolate attemptKey so the child OCR request does not conflict with the parent report reservation budget
  const { attemptKey: _omit, ...subOptions } = options;

  for (const part of prompt) {
    if (!part.inlineData) {
      processedParts.push(part);
      continue;
    }

    // Attempt OCR extraction if a vision provider is available
    if (visionProvider) {
      try {
        const ocrPrompt: ContentPart[] = [
          part,
          {
            text: 'Hãy đọc và trích xuất toàn bộ văn bản, số liệu, hóa đơn hoặc nội dung trao đổi trong hình ảnh này. Trình bày trung thực, ngắn gọn bằng tiếng Việt.',
          },
        ];

        const extractedText = await visionProvider.generateContent(ocrPrompt, {
          ...subOptions,
          systemInstruction: 'Bạn là chuyên gia OCR trích xuất thông tin tài liệu và chứng từ kinh doanh.',
          maxOutputTokens: 1024,
        });

        processedParts.push({
          text: `\n[Nội dung trích xuất từ ảnh đính kèm]:\n${extractedText.trim()}\n`,
        });
        continue;
      } catch (err: any) {
        logger.warn(`[vision-bridge] Vision OCR extraction failed, falling back gracefully: ${err?.message}`);
        processedParts.push({ text: `\n${VISION_FAIL_NOTICE}\n` });
        continue;
      }
    }

    // Graceful degradation when vision provider is unavailable
    processedParts.push({ text: `\n${MISSING_VISION_NOTICE}\n` });
  }

  return processedParts;
}
