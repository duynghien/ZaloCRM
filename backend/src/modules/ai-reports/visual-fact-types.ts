/**
 * visual-fact-types.ts — Type definitions and schema contracts for two-step multimodal fact extraction.
 * Guarantees schema purity and decouples visual fact analysis from employee chat statements.
 */
import type { ImageCandidate } from './attachment-burst-sampler.js';
import type { ContentPart } from './providers/ai-provider-interface.js';

export interface LoadedPhotoCandidate {
  candidate: ImageCandidate;
  part: ContentPart;
  buffer: Buffer;
  mimeType: string;
}

export interface MeasuringDeviceFact {
  hasScale: boolean;
  scaleReading: string | null;
  unit: string | null;
}

export interface TextLabelFact {
  type: 'watermark' | 'receipt' | 'label' | 'other';
  content: string;
}

export interface VerifiedVisualFact {
  photoIndex: number;
  hasVisualEvidence: boolean;
  photoUrl?: string;
  localPath?: string;
  senderId?: string;
  senderName?: string;
  sentAtMs?: number;
  objects: string[];
  visualCondition: string;
  measuringDevice: MeasuringDeviceFact;
  textLabels: TextLabelFact[];
  evidenceSummary: string;
}

/**
 * Creates a safe, structured fallback fact when vision processing is unavailable or fails.
 */
export function createDefaultFallbackFact(
  photoIndex: number,
  candidate?: ImageCandidate,
  reason: string = 'Không thể trích xuất chi tiết ảnh do sự cố Vision API',
): VerifiedVisualFact {
  return {
    photoIndex,
    hasVisualEvidence: false,
    photoUrl: candidate?.url,
    localPath: candidate?.localPath,
    senderId: candidate?.senderId,
    senderName: candidate?.senderName,
    sentAtMs: candidate?.sentAtMs,
    objects: [],
    visualCondition: 'Không xác định',
    measuringDevice: {
      hasScale: false,
      scaleReading: null,
      unit: null,
    },
    textLabels: [],
    evidenceSummary: reason,
  };
}
