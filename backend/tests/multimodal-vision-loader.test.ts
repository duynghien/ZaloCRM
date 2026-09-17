import { describe, expect, it, vi } from 'vitest';
import {
  isWhitelistedZaloCdnUrl,
  sniffImageMimeType,
} from '../src/modules/ai-reports/attachment-image-loader.js';
import { preprocessMultimodalPrompt } from '../src/modules/ai-reports/providers/smart-hybrid-vision-bridge.js';
import type { AiProvider, ContentPart, GenerateOptions } from '../src/modules/ai-reports/providers/ai-provider-interface.js';

describe('Multimodal Vision Loader & Whitelist', () => {
  it('whitelists valid Zalo CDN domains and rejects others', () => {
    expect(isWhitelistedZaloCdnUrl('https://photo-stal-01.zdn.vn/abc.jpg')).toBe(true);
    expect(isWhitelistedZaloCdnUrl('https://photo-stal-abc-12.zdn.vn/path/image.png?w=500')).toBe(true);
    expect(isWhitelistedZaloCdnUrl('https://zaloapp.com/photos/123.jpg')).toBe(true);
    expect(isWhitelistedZaloCdnUrl('https://sub.zaloapp.com/photo.png')).toBe(true);

    // Reject malicious/external domains
    expect(isWhitelistedZaloCdnUrl('http://photo-stal-01.zdn.vn/abc.jpg')).toBe(false); // non-https
    expect(isWhitelistedZaloCdnUrl('https://attacker.com/image.jpg')).toBe(false);
    expect(isWhitelistedZaloCdnUrl('https://photo-stal-01.zdn.vn.attacker.com/evil.jpg')).toBe(false);
    expect(isWhitelistedZaloCdnUrl('https://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isWhitelistedZaloCdnUrl('invalid-url')).toBe(false);
  });

  it('sniffs magic bytes correctly for JPEG, PNG, WebP and GIF', () => {
    const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(sniffImageMimeType(jpegHeader)).toBe('image/jpeg');

    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(sniffImageMimeType(pngHeader)).toBe('image/png');

    const webpHeader = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from('WEBP'),
    ]);
    expect(sniffImageMimeType(webpHeader)).toBe('image/webp');

    const gifHeader = Buffer.from('GIF89a...');
    expect(sniffImageMimeType(gifHeader)).toBe('image/gif');

    const randomBytes = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    expect(sniffImageMimeType(randomBytes)).toBeNull();
  });
});

describe('Smart Hybrid Vision Bridge (Graceful Fallback & Attempt Isolation)', () => {
  const dummyBudget: any = {
    complete: vi.fn(),
    charge: vi.fn(),
    reserve: vi.fn(),
  };

  const dummyOptions: GenerateOptions = {
    budget: dummyBudget,
    attemptKey: 'attempt-123',
    executionGuard: async () => {},
  };

  const textProvider: AiProvider = {
    type: 'deepseek',
    supportsVision: false,
    generateContent: vi.fn(),
    testConnection: vi.fn(),
    estimateTokens: vi.fn(),
  };

  const visionProvider: AiProvider = {
    type: 'gemini',
    supportsVision: true,
    generateContent: vi.fn(),
    testConnection: vi.fn(),
    estimateTokens: vi.fn(),
  };

  it('gracefully degrades when visionProvider throws without crashing', async () => {
    vi.mocked(visionProvider.generateContent).mockRejectedValueOnce(new Error('Rate limit 429'));

    const promptWithImage: ContentPart[] = [
      { text: 'Prompt text' },
      { inlineData: { mimeType: 'image/jpeg', data: 'dGVzdA==' } },
    ];

    const result = await preprocessMultimodalPrompt(
      promptWithImage,
      textProvider,
      visionProvider,
      dummyOptions,
    );

    expect(Array.isArray(result)).toBe(true);
    const parts = result as ContentPart[];
    expect(parts.some((p) => p.text?.includes('[Không thể giải mã ảnh do sự cố Vision Bridge]'))).toBe(true);
    // Verify attemptKey was not passed into generateContent
    expect(visionProvider.generateContent).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ attemptKey: 'attempt-123' }),
    );
  });
});
