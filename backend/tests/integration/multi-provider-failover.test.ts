/**
 * multi-provider-failover.test.ts — Comprehensive test suite for Multi-Provider AI Adapter,
 * failover routing, single budget reservation, SSRF guard, and vision degradation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { estimateTokensHeuristic } from '../../src/modules/ai-reports/providers/token-budget-estimator.js';
import { GeminiProvider } from '../../src/modules/ai-reports/providers/gemini-provider.js';
import { OpenAiCompatibleProvider } from '../../src/modules/ai-reports/providers/openai-compatible-provider.js';
import { AiProviderRouter } from '../../src/modules/ai-reports/providers/ai-provider-router.js';
import { preprocessMultimodalPrompt } from '../../src/modules/ai-reports/providers/smart-hybrid-vision-bridge.js';
import { validateAiGatewayUrl } from '../../src/modules/ai-reports/ai-gateway-validator.js';
import { validateReportHttpRequest } from '../../src/modules/ai-reports/report-http-validation.js';
import { getOrgAiProviderSettingsDto, saveOrgAiProviderSettings } from '../../src/modules/ai-reports/ai-provider-settings-service.js';
import { extractImagePartsFromMessages } from '../../src/modules/ai-reports/attachment-image-loader.js';
import { prisma } from '../../src/shared/database/prisma-client.js';
import { config } from '../../src/config/index.js';
import type { ReportJobBudget } from '../../src/modules/ai-reports/report-job-budget.js';

describe('1. Heuristic Token Estimator', () => {
  it('correctly calculates token count for Vietnamese text using 1.5 chars/tok with 20% margin', () => {
    const text = 'Hôm nay có 5 đơn hàng mới cần giao gấp'; // 38 characters
    const expected = Math.ceil((38 / 1.5) * 1.2); // Math.ceil(25.33 * 1.2) = Math.ceil(30.4) = 31
    const tokens = estimateTokensHeuristic(text);
    expect(tokens).toBe(expected);
  });

  it('adds standard image tokens (1200 tok) for each inlineData image part', () => {
    const prompt = [
      { text: 'Kiểm tra hóa đơn này:' }, // 21 chars -> Math.ceil((21 / 1.5) * 1.2) = 17
      { inlineData: { mimeType: 'image/jpeg', data: 'base64imagecontent' } },
      { inlineData: { mimeType: 'image/png', data: 'secondimagecontent' } },
    ];
    const tokens = estimateTokensHeuristic(prompt);
    expect(tokens).toBe(17 + 2 * 1200);
  });
});

describe('2. Gemini & OpenAI Provider Adapters', () => {
  it('GeminiProvider handles generation and token estimation fallback', async () => {
    const provider = new GeminiProvider({
      type: 'gemini',
      apiKey: 'test-key',
      model: 'gemini-2.5-flash',
    });
    expect(provider.type).toBe('gemini');
    expect(provider.supportsVision).toBe(true);

    const est = await provider.estimateTokens('Chào mừng bạn đến với ZaloCRM');
    expect(est).toBeGreaterThan(0);
  });

  it('OpenAiCompatibleProvider initializes with correct defaults for DeepSeek and OpenAI', () => {
    const deepseek = new OpenAiCompatibleProvider({
      type: 'deepseek',
      apiKey: 'sk-deepseek-test',
      model: 'deepseek-chat',
    });
    expect(deepseek.type).toBe('deepseek');
    expect(deepseek.supportsVision).toBe(false);

    const openai = new OpenAiCompatibleProvider({
      type: 'openai',
      apiKey: 'sk-openai-test',
      model: 'gpt-4o-mini',
    });
    expect(openai.type).toBe('openai');
    expect(openai.supportsVision).toBe(true);
  });
});

describe('3. Single Budget Reservation Across Failover Chain', () => {
  it('reserves budget once and reuses attemptKey across failover without second reservation', async () => {
    let reserveCallCount = 0;
    const mockBudget: ReportJobBudget = {
      reserve: vi.fn(async (inputTokens: number, maxOutputTokens: number) => {
        reserveCallCount++;
        return { attemptKey: 'attempt-123', maxOutputTokens };
      }),
      complete: vi.fn(async () => {}),
    };

    const router = new AiProviderRouter({
      primaryProvider: 'gemini',
      providers: {
        gemini: { type: 'gemini', apiKey: 'key-g', model: 'gemini-2.5-flash' },
        deepseek: { type: 'deepseek', apiKey: 'key-d', model: 'deepseek-chat' },
      },
      fallbackEnabled: true,
      fallbackChain: ['deepseek'],
      allowSystemFallback: true,
    });

    // Mock primary provider failing and secondary provider succeeding
    const gemini = router.getProvider('gemini')!;
    const deepseek = router.getProvider('deepseek')!;

    vi.spyOn(gemini, 'generateContent').mockRejectedValue(new Error('HTTP 429 Rate limit exceeded'));
    vi.spyOn(deepseek, 'generateContent').mockResolvedValue('Tóm tắt thành công từ DeepSeek');

    const fallbackTelemetryList: any[] = [];
    const result = await router.generateContent('Phân tích nhóm dự án', {
      budget: mockBudget,
      executionGuard: async () => {},
      onFallback: (t) => fallbackTelemetryList.push(t),
    });

    expect(result).toBe('Tóm tắt thành công từ DeepSeek');
    expect(reserveCallCount).toBe(1); // Crucial invariant: Only 1 reserve call!
    expect(fallbackTelemetryList.length).toBe(1);
    expect(fallbackTelemetryList[0].isFallback).toBe(true);
    expect(fallbackTelemetryList[0].fallbackProvider).toBe('deepseek');
  });
});

describe('4. Smart Hybrid Vision & Graceful Degradation', () => {
  it('extracts text via Vision provider when target provider does not support vision', async () => {
    const textOnlyProvider: any = { type: 'deepseek', supportsVision: false };
    const visionProvider: any = {
      type: 'gemini',
      supportsVision: true,
      generateContent: vi.fn(async () => 'Số tiền: 500,000 VND, Mã đơn: ZL-998'),
    };

    const prompt = [
      { text: 'Xem ảnh đính kèm:' },
      { inlineData: { mimeType: 'image/jpeg', data: 'fakebase64' } },
    ];

    const processed = await preprocessMultimodalPrompt(
      prompt,
      textOnlyProvider,
      visionProvider,
      { budget: {} as any, executionGuard: async () => {} },
    );

    expect(Array.isArray(processed)).toBe(true);
    const parts = processed as any[];
    expect(parts[0].text).toBe('Xem ảnh đính kèm:');
    expect(parts[1].text).toContain('[Nội dung trích xuất từ ảnh đính kèm]');
    expect(parts[1].text).toContain('500,000 VND');
  });

  it('replaces image with graceful placeholder when vision provider is unavailable', async () => {
    const textOnlyProvider: any = { type: 'deepseek', supportsVision: false };
    const prompt = [
      { text: 'Tin nhắn' },
      { inlineData: { mimeType: 'image/png', data: 'fakebase64' } },
    ];

    const processed = await preprocessMultimodalPrompt(
      prompt,
      textOnlyProvider,
      null, // No vision provider available
      { budget: {} as any, executionGuard: async () => {} },
    );

    const parts = processed as any[];
    expect(parts[1].text).toContain('[Hình ảnh không được phân tích do thiếu Vision Provider]');
  });
});

describe('5. SSRF & Base URL Policy', () => {
  const originalFlag = config.allowPrivateAiGateways;

  afterEach(() => {
    (config as any).allowPrivateAiGateways = originalFlag;
  });

  it('rejects internal IP addresses and localhost when ALLOW_PRIVATE_AI_GATEWAYS is false', async () => {
    (config as any).allowPrivateAiGateways = false;

    await expect(validateAiGatewayUrl('http://api.openai.com/v1')).rejects.toThrow('phải sử dụng giao thức HTTPS');
    await expect(validateAiGatewayUrl('https://127.0.0.1:8000/v1')).rejects.toThrow();
    await expect(validateAiGatewayUrl('https://localhost:11434/v1')).rejects.toThrow('Không được phép sử dụng localhost');
    await expect(validateAiGatewayUrl('https://169.254.169.254/latest')).rejects.toThrow();
    await expect(validateAiGatewayUrl('https://192.168.1.1:8080/v1')).rejects.toThrow();
  });

  it('permits localhost and LAN addresses when ALLOW_PRIVATE_AI_GATEWAYS is true', async () => {
    (config as any).allowPrivateAiGateways = true;

    await expect(validateAiGatewayUrl('http://127.0.0.1:11434/v1')).resolves.toBeUndefined();
    await expect(validateAiGatewayUrl('http://localhost:11434/v1')).resolves.toBeUndefined();
    await expect(validateAiGatewayUrl('http://192.168.1.100:8000/v1')).resolves.toBeUndefined();
  });
});

describe('6. HTTP PreHandler Validation for aiProviders', () => {
  it('accepts valid aiProviders payload with allowSystemFallback', () => {
    const request: any = {
      method: 'PUT',
      routeOptions: { url: '/api/v1/ai-reports/settings' },
      params: {},
      body: {
        aiProviders: {
          primaryProvider: 'deepseek',
          fallbackEnabled: true,
          fallbackChain: ['gemini', 'openai'],
          allowSystemFallback: true,
          providers: {
            deepseek: { type: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-123456789' },
          },
        },
      },
    };

    expect(() => validateReportHttpRequest(request)).not.toThrow();
  });

  it('rejects invalid primary provider or unknown fields', () => {
    const invalidProvider: any = {
      method: 'PUT',
      routeOptions: { url: '/api/v1/ai-reports/settings' },
      params: {},
      body: {
        aiProviders: {
          primaryProvider: 'invalid-ai',
        },
      },
    };
    expect(() => validateReportHttpRequest(invalidProvider)).toThrow();

    const unknownField: any = {
      method: 'PUT',
      routeOptions: { url: '/api/v1/ai-reports/settings' },
      params: {},
      body: {
        unknownKey: 'value',
      },
    };
    expect(() => validateReportHttpRequest(unknownField)).toThrow('Unknown settings field');
  });
});

describe('7. AbortSignal Cancellation', () => {
  it('stops immediately when signal is already aborted', async () => {
    const router = new AiProviderRouter({
      primaryProvider: 'gemini',
      providers: {
        gemini: { type: 'gemini', apiKey: 'test', model: 'gemini-2.5-flash' },
      },
      fallbackEnabled: false,
      fallbackChain: [],
      allowSystemFallback: false,
    });

    const abortController = new AbortController();
    abortController.abort();

    await expect(
      router.generateContent('test prompt', {
        budget: { reserve: async () => ({ attemptKey: 'k', maxOutputTokens: 100 }), complete: async () => {} } as any,
        executionGuard: async () => {},
        signal: abortController.signal,
      }),
    ).rejects.toThrow('Generation aborted');
  });
});

describe('8. AI Settings Security & DTO Isolation', () => {
  it('rejects saving private/loopback baseUrl in saveOrgAiProviderSettings when ALLOW_PRIVATE_AI_GATEWAYS=false', async () => {
    (config as any).allowPrivateAiGateways = false;
    vi.spyOn(prisma.appSetting, 'findUnique').mockResolvedValue(null as any);
    vi.spyOn(prisma.appSetting, 'upsert').mockResolvedValue({} as any);

    await expect(
      saveOrgAiProviderSettings('test-org-1', {
        providers: {
          custom: {
            type: 'custom',
            model: 'custom-model',
            apiKey: 'test-key',
            baseUrl: 'http://169.254.169.254/v1',
          },
        },
      }),
    ).rejects.toThrow();
  });

  it('never leaks host .env API keys in getOrgAiProviderSettingsDto', async () => {
    vi.spyOn(prisma.appSetting, 'findUnique').mockResolvedValue(null as any);

    const dto = await getOrgAiProviderSettingsDto('unconfigured-org-xyz');
    expect(dto.isSystemDefault).toBe(true);
    for (const [provider, detail] of Object.entries(dto.providers)) {
      expect(detail.apiKey).toBe(''); // Host raw keys are never leaked to client DTO
    }
  });

  it('never leaks host .env API keys even if database returns corrupted JSON', async () => {
    vi.spyOn(prisma.appSetting, 'findUnique').mockResolvedValue({
      valueCiphertext: 'corrupted',
      valueIv: 'corrupted',
      valueAuthTag: 'corrupted',
      valuePlain: '{ corrupted json syntax',
    } as any);

    const dto = await getOrgAiProviderSettingsDto('corrupted-org');
    expect(dto.isSystemDefault).toBe(true);
    for (const [provider, detail] of Object.entries(dto.providers)) {
      expect(detail.apiKey).toBe('');
    }
  });
});

describe('9. Path Traversal Guard in Attachment Loader', () => {
  it('ignores attachment files pointing outside uploadDir', async () => {
    const maliciousMessages = [
      {
        attachments: [
          {
            mimeType: 'image/png',
            localPath: '/etc/passwd',
          },
          {
            mimeType: 'image/jpeg',
            localPath: '../../../../secret.png',
          },
        ],
      },
    ];

    const parts = await extractImagePartsFromMessages(maliciousMessages);
    expect(parts).toHaveLength(0);
  });
});

describe('10. OpenAI-Compatible Content String Normalization', () => {
  it('normalizes prompt array of text-only parts to a single string for DeepSeek chat compatibility', async () => {
    const provider = new OpenAiCompatibleProvider({
      type: 'deepseek',
      apiKey: 'sk-mock',
      model: 'deepseek-chat',
    });

    let sentMessages: any = null;
    (provider as any).client = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async (params: any) => {
            sentMessages = params.messages;
            return {
              choices: [{ message: { content: 'DeepSeek response' } }],
              usage: { prompt_tokens: 10, completion_tokens: 10 },
            };
          }),
        },
      },
    };

    const textOnlyParts = [
      { text: 'Phần mở đầu báo cáo.' },
      { text: 'Phần tổng hợp số liệu.' },
    ];

    const result = await provider.generateContent(textOnlyParts, {
      budget: { reserve: async () => ({ attemptKey: 'k', maxOutputTokens: 100 }), complete: async () => {} } as any,
      executionGuard: async () => {},
    });

    expect(result).toBe('DeepSeek response');
    expect(sentMessages).toHaveLength(1);
    expect(typeof sentMessages[0].content).toBe('string');
    expect(sentMessages[0].content).toContain('Phần mở đầu báo cáo.');
    expect(sentMessages[0].content).toContain('Phần tổng hợp số liệu.');
  });
});

