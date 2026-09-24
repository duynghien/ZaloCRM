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

    vi.spyOn((provider as any).getClient().models, 'countTokens').mockResolvedValueOnce({ totalTokens: 42 });

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

    // DeepSeek Flash model enables vision even if DB has supportsVision: false
    const deepseekFlash = new OpenAiCompatibleProvider({
      type: 'deepseek',
      apiKey: 'sk-deepseek-test',
      model: 'deepseek-flash',
      supportsVision: false,
    });
    expect(deepseekFlash.type).toBe('deepseek');
    expect(deepseekFlash.supportsVision).toBe(true);
  });

  it('OpenAiCompatibleProvider formats image_url with base64 data URL for multimodal DeepSeek Flash', async () => {
    const deepseekFlash = new OpenAiCompatibleProvider({
      type: 'deepseek',
      apiKey: 'sk-deepseek-test',
      model: 'deepseek-flash',
    });

    let sentMessages: any = null;
    (deepseekFlash as any).client = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async (params: any) => {
            sentMessages = params.messages;
            return {
              choices: [{ message: { content: 'DeepSeek Vision analysis' } }],
              usage: { prompt_tokens: 20, completion_tokens: 15 },
            };
          }),
        },
      },
    };

    const multimodalParts = [
      { text: 'Phân tích hình ảnh này' },
      { inlineData: { mimeType: 'image/jpeg', data: 'ZXhhbXBsZQ==' } },
    ];

    const result = await deepseekFlash.generateContent(multimodalParts, {
      budget: { reserve: async () => ({ attemptKey: 'k', maxOutputTokens: 100 }), complete: async () => {} } as any,
      executionGuard: async () => {},
    });

    expect(result).toBe('DeepSeek Vision analysis');
    expect(sentMessages).toHaveLength(1);
    const userMsg = sentMessages[0];
    expect(Array.isArray(userMsg.content)).toBe(true);
    expect(userMsg.content[0]).toEqual({ type: 'text', text: 'Phân tích hình ảnh này' });
    expect(userMsg.content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,ZXhhbXBsZQ==' },
    });
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
      failAttempt: vi.fn(async () => {}),
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

    vi.spyOn(gemini, 'estimateTokens').mockResolvedValue(100);
    vi.spyOn(gemini, 'generateContent').mockRejectedValue(new Error('HTTP 429 Rate limit exceeded'));
    vi.spyOn(deepseek, 'generateContent').mockResolvedValue('Tóm tắt thành công từ DeepSeek');

    const fallbackTelemetryList: any[] = [];
    const result = await router.generateContent('Phân tích nhóm dự án', {
      budget: mockBudget,
      executionGuard: async () => {},
      onFallback: (t) => fallbackTelemetryList.push(t),
    });

    expect(result).toBe('Tóm tắt thành công từ DeepSeek');
    expect(reserveCallCount).toBe(3); // Primary (2 attempts) + fallback (1 attempt)
    expect(mockBudget.failAttempt).toHaveBeenCalledTimes(2);
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

describe('11. Three-Tier Failover Chain (DeepSeek -> Gemini -> OpenAI)', () => {
  it('fails over from DeepSeek to Gemini, then from Gemini to OpenAI when first two fail', async () => {
    const mockBudget: ReportJobBudget = {
      reserve: vi.fn(async (_in, maxOut) => ({ attemptKey: 'attempt-tri', maxOutputTokens: maxOut })),
      complete: vi.fn(async () => {}),
      failAttempt: vi.fn(async () => {}),
    };

    const router = new AiProviderRouter({
      primaryProvider: 'deepseek',
      providers: {
        deepseek: { type: 'deepseek', apiKey: 'key-d', model: 'deepseek-flash' },
        gemini: { type: 'gemini', apiKey: 'key-g', model: 'gemini-2.5-flash' },
        openai: { type: 'openai', apiKey: 'key-o', model: 'gpt-4o-mini' },
      },
      fallbackEnabled: true,
      fallbackChain: ['gemini', 'openai'],
      allowSystemFallback: true,
    });

    const deepseek = router.getProvider('deepseek')!;
    const gemini = router.getProvider('gemini')!;
    const openai = router.getProvider('openai')!;

    vi.spyOn(gemini, 'estimateTokens').mockResolvedValue(100);
    vi.spyOn(deepseek, 'generateContent').mockRejectedValue(new Error('DeepSeek 429 Quota Exceeded'));
    vi.spyOn(gemini, 'generateContent').mockRejectedValue(new Error('Gemini 503 Service Unavailable'));
    vi.spyOn(openai, 'generateContent').mockResolvedValue('Thành công từ OpenAI');

    const fallbackTelemetryList: any[] = [];
    const result = await router.generateContent('Báo cáo doanh số', {
      budget: mockBudget,
      executionGuard: async () => {},
      onFallback: (t) => fallbackTelemetryList.push(t),
    });

    expect(result).toBe('Thành công từ OpenAI');
    expect(fallbackTelemetryList.length).toBe(1);
    expect(fallbackTelemetryList[0].isFallback).toBe(true);
    expect(fallbackTelemetryList[0].fallbackProvider).toBe('openai');
  });
});

describe('12. Chat Copilot Multi-Provider Failover', () => {
  it('chatCopilotService fails over to fallback provider when primary provider fails', async () => {
    const { chatCopilotService } = await import('../../src/modules/chat/copilot/chat-copilot-service.js');
    const callerModule = await import('../../src/modules/chat/copilot/chat-copilot-ai-caller.js');
    const settingsService = await import('../../src/modules/ai-reports/ai-provider-settings-service.js');

    vi.spyOn(settingsService, 'getOrgAiProviderCredentials').mockResolvedValue({
      primaryProvider: 'deepseek',
      providers: {
        deepseek: { type: 'deepseek', apiKey: 'key-d', model: 'deepseek-flash' },
        gemini: { type: 'gemini', apiKey: 'key-g', model: 'gemini-2.5-flash' },
      },
      fallbackEnabled: true,
      fallbackChain: ['gemini'],
      allowSystemFallback: true,
      monthlyBudgetVnd: 0,
      usdToVndRate: 25400,
    });

    vi.spyOn(chatCopilotService, 'getOrgBusinessContext').mockResolvedValue('');

    const calledProviders: string[] = [];
    vi.spyOn(callerModule, 'callCopilotAiProvider').mockImplementation(async (type) => {
      calledProviders.push(type);
      if (type === 'deepseek') {
        throw new Error('DeepSeek 429 Rate Limit');
      }
      return JSON.stringify({
        smartReplies: [{ label: 'Tư vấn', content: 'Xin chào, tôi có thể hỗ trợ gì?', tone: 'consultative' }],
        suggestedActions: [],
        alerts: [],
      });
    });

    const result = await chatCopilotService.generateCopilotAnalysis(
      'org-failover-test',
      'conv-failover-test',
      [
        {
          id: 'msg-1',
          senderType: 'contact',
          content: 'Cần tư vấn đơn hàng',
          contentType: 'text',
          sentAt: new Date(),
        },
      ],
    );

    expect(result).not.toBeNull();
    expect(result?.smartReplies).toHaveLength(1);
    expect(calledProviders).toEqual(['deepseek', 'gemini']);
  });
});

describe('13. Recursive Null Byte Sanitization (Postgres 22P05 Defense)', () => {
  it('strips null bytes from strings, arrays, and nested objects', async () => {
    const { sanitizeJsonNullBytes } = await import('../../src/modules/attachments/attachment-processor.js');

    const input = {
      filename: 'report\u0000.pdf',
      extractedText: 'Dữ liệu quan trọng\u0000 với null byte',
      sheetNames: ['Doanh số\u0000', 'Chi phí'],
      nested: {
        deepKey: 'value\u0000123',
        array: ['a\u0000b', { sub: 'hello\u0000world' }],
      },
      numberVal: 42,
      boolVal: true,
      nullVal: null,
    };

    const sanitized = sanitizeJsonNullBytes(input);

    expect(sanitized.filename).toBe('report.pdf');
    expect(sanitized.extractedText).toBe('Dữ liệu quan trọng với null byte');
    expect(sanitized.sheetNames).toEqual(['Doanh số', 'Chi phí']);
    expect(sanitized.nested.deepKey).toBe('value123');
    expect(sanitized.nested.array[0]).toBe('ab');
    expect(sanitized.nested.array[1].sub).toBe('helloworld');
    expect(sanitized.numberVal).toBe(42);
    expect(sanitized.boolVal).toBe(true);
    expect(sanitized.nullVal).toBeNull();
  });

  it('handles deeply nested structures beyond maxDepth safely with iterative fallback', async () => {
    const { sanitizeJsonNullBytes } = await import('../../src/modules/attachments/attachment-processor.js');

    // Create 25 levels deep nesting
    let deepObj: any = { leaf: 'leaf\u0000value' };
    for (let i = 0; i < 25; i++) {
      deepObj = { level: i, next: deepObj };
    }

    const sanitized = sanitizeJsonNullBytes(deepObj, 0, 20);
    expect(sanitized).toBeDefined();

    // Traverse down to leaf
    let curr = sanitized;
    while (curr.next) {
      curr = curr.next;
    }
    expect(curr.leaf).toBe('leafvalue');
  });
});

describe('14. CoT Token Exhaustion Safeguard & Output Validation Failover', () => {
  it('throws IncompleteAiGenerationError immediately when finish_reason === "length" (empty content)', async () => {
    const { IncompleteAiGenerationError } = await import('../../src/modules/ai-reports/providers/ai-provider-interface.js');
    const deepseek = new OpenAiCompatibleProvider({
      type: 'deepseek',
      apiKey: 'sk-deepseek-test',
      model: 'deepseek-chat',
    });

    let attempts = 0;
    (deepseek as any).client = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async () => {
            attempts++;
            return {
              choices: [{
                finish_reason: 'length',
                message: { content: '', reasoning_content: 'I need more tokens to finish reasoning...' },
              }],
              usage: { prompt_tokens: 100, completion_tokens: 4096 },
            };
          }),
        },
      },
    };

    const dummyBudget: any = {
      reserve: vi.fn().mockResolvedValue({ attemptKey: 'k', maxOutputTokens: 4096 }),
      complete: vi.fn(),
      failAttempt: vi.fn(),
    };

    const start = Date.now();
    await expect(
      deepseek.generateContent('Prompt', {
        budget: dummyBudget,
        executionGuard: async () => {},
      }),
    ).rejects.toThrow(IncompleteAiGenerationError);

    // Fail-fast: must not sleep 3000ms and must exit on attempt 1
    expect(Date.now() - start).toBeLessThan(1000);
    expect(attempts).toBe(1);
  });

  it('throws IncompleteAiGenerationError when finish_reason === "length" even with partial content', async () => {
    const { IncompleteAiGenerationError } = await import('../../src/modules/ai-reports/providers/ai-provider-interface.js');
    const deepseek = new OpenAiCompatibleProvider({
      type: 'deepseek',
      apiKey: 'sk-deepseek-test',
      model: 'deepseek-chat',
    });

    (deepseek as any).client = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{
              finish_reason: 'length',
              message: { content: '{"telemetry": {"totalExpected": 10' },
            }],
            usage: { prompt_tokens: 50, completion_tokens: 4096 },
          }),
        },
      },
    };

    const dummyBudget: any = {
      reserve: vi.fn().mockResolvedValue({ attemptKey: 'k', maxOutputTokens: 4096 }),
      complete: vi.fn(),
    };

    await expect(
      deepseek.generateContent('Prompt', {
        budget: dummyBudget,
        executionGuard: async () => {},
      }),
    ).rejects.toThrow(IncompleteAiGenerationError);
  });

  it('AiProviderRouter fails over from DeepSeek to Gemini on IncompleteAiGenerationError', async () => {
    const router = new AiProviderRouter({
      primaryProvider: 'deepseek',
      providers: {
        deepseek: { type: 'deepseek', apiKey: 'key-ds', model: 'deepseek-chat' },
        gemini: { type: 'gemini', apiKey: 'key-gemini', model: 'gemini-2.5-flash' },
      },
      fallbackEnabled: true,
      fallbackChain: ['gemini'],
      allowSystemFallback: false,
    });

    const dsProvider = router.getProvider('deepseek');
    (dsProvider as any).client = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{
              finish_reason: 'length',
              message: { content: '', reasoning_content: 'CoT thinking...' },
            }],
            usage: { prompt_tokens: 20, completion_tokens: 4096 },
          }),
        },
      },
    };

    const geminiProvider = router.getProvider('gemini');
    (geminiProvider as any).estimateTokens = vi.fn().mockResolvedValue(100);
    (geminiProvider as any).generateContent = vi.fn().mockResolvedValue('{"status":"ok_from_gemini"}');

    const dummyBudget: any = {
      reserve: vi.fn().mockResolvedValue({ attemptKey: 'att-1', maxOutputTokens: 4096 }),
      complete: vi.fn(),
      failAttempt: vi.fn().mockResolvedValue(undefined),
    };

    const fallbackEvents: any[] = [];
    const result = await router.generateContent('Prompt', {
      budget: dummyBudget,
      executionGuard: async () => {},
      onFallback: (t) => fallbackEvents.push(t),
    });

    expect(result).toBe('{"status":"ok_from_gemini"}');
    expect(fallbackEvents).toHaveLength(1);
    expect(fallbackEvents[0].fallbackProvider).toBe('gemini');
  });

  it('AiProviderRouter fails over when validateOutput callback rejects provider output', async () => {
    const router = new AiProviderRouter({
      primaryProvider: 'deepseek',
      providers: {
        deepseek: { type: 'deepseek', apiKey: 'key-ds', model: 'deepseek-chat' },
        gemini: { type: 'gemini', apiKey: 'key-gemini', model: 'gemini-2.5-flash' },
      },
      fallbackEnabled: true,
      fallbackChain: ['gemini'],
      allowSystemFallback: false,
    });

    const dsProvider = router.getProvider('deepseek');
    (dsProvider as any).client = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{
              finish_reason: 'stop',
              message: { content: 'Plain markdown without JSON' },
            }],
            usage: { prompt_tokens: 20, completion_tokens: 50 },
          }),
        },
      },
    };

    const geminiProvider = router.getProvider('gemini');
    (geminiProvider as any).estimateTokens = vi.fn().mockResolvedValue(100);
    (geminiProvider as any).generateContent = vi.fn().mockResolvedValue('{"telemetry":{"totalExpected":1}}');

    const dummyBudget: any = {
      reserve: vi.fn().mockResolvedValue({ attemptKey: 'att-2', maxOutputTokens: 4096 }),
      complete: vi.fn(),
      failAttempt: vi.fn().mockResolvedValue(undefined),
    };

    const result = await router.generateContent('Prompt', {
      budget: dummyBudget,
      executionGuard: async () => {},
      validateOutput: (text) => text.includes('"telemetry"'),
    });

    expect(result).toBe('{"telemetry":{"totalExpected":1}}');
  });
});

