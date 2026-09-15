/**
 * token-budget-estimator.ts — Calibrated token estimation for Vietnamese text and multimodal inputs.
 */
import type { ContentPart } from './ai-provider-interface.js';

// Calibrated ratio for Vietnamese text using BPE tokenizers (OpenAI, DeepSeek)
// Vietnamese diacritics and syllables consume ~1 token per 1.5 characters, with a 20% safety margin.
const VIETNAMESE_CHARS_PER_TOKEN = 1.5;
const SAFETY_MARGIN_MULTIPLIER = 1.20;

// Standard token cost for image attachments (receipts, screenshots, docs)
const TOKENS_PER_IMAGE_ATTACHMENT = 1200;

/**
 * Estimate token count safely for text and multimodal content parts.
 */
export function estimateTokensHeuristic(prompt: string | ContentPart[]): number {
  let textCharCount = 0;
  let imageCount = 0;

  if (typeof prompt === 'string') {
    textCharCount = prompt.length;
  } else if (Array.isArray(prompt)) {
    for (const part of prompt) {
      if (part.text) {
        textCharCount += part.text.length;
      }
      if (part.inlineData) {
        imageCount += 1;
      }
    }
  }

  const textTokens = Math.ceil((textCharCount / VIETNAMESE_CHARS_PER_TOKEN) * SAFETY_MARGIN_MULTIPLIER);
  const imageTokens = imageCount * TOKENS_PER_IMAGE_ATTACHMENT;

  return Math.max(1, textTokens + imageTokens);
}
