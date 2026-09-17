import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as trackerModule from '../src/modules/ai-reports/ai-usage-tracker.js';
import { GeminiProvider } from '../src/modules/ai-reports/providers/gemini-provider.js';
import { OpenAiCompatibleProvider } from '../src/modules/ai-reports/providers/openai-compatible-provider.js';
import { preprocessMultimodalPrompt } from '../src/modules/ai-reports/providers/smart-hybrid-vision-bridge.js';

describe('ai-telemetry-interceptors', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('gemini-provider records usage and fires onUsage on successful generation', async () => {
    const recordSpy = vi.spyOn(trackerModule, 'recordAiUsage').mockImplementation(() => {});
    const onUsageMock = vi.fn();

    const provider = new GeminiProvider({
      type: 'gemini',
      apiKey: 'test-key',
      model: 'gemini-3.6-flash',
    });

    // Mock internal client
    const mockGenerateContent = vi.fn().mockResolvedValue({
      text: 'Gemini reply',
      usageMetadata: {
        promptTokenCount: 150,
        candidatesTokenCount: 50,
        cachedContentTokenCount: 20,
        totalTokenCount: 200,
      },
    });

    (provider as any).getClient = () => ({
      models: {
        generateContent: mockGenerateContent,
      },
    });

    const mockBudget = {
      reserve: vi.fn(),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn(),
    };

    const res = await provider.generateContent('hello', {
      budget: mockBudget as any,
      executionGuard: async () => {},
      orgId: 'org-test-1',
      taskType: 'executive_report',
      onUsage: onUsageMock,
    });

    expect(res).toBe('Gemini reply');
    expect(onUsageMock).toHaveBeenCalledWith({
      inputTokens: 150,
      outputTokens: 50,
      cachedTokens: 20,
      totalTokens: 200,
    });

    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-test-1',
        taskType: 'executive_report',
        provider: 'gemini',
        model: 'gemini-3.6-flash',
        status: 'success',
        usage: {
          inputTokens: 150,
          outputTokens: 50,
          cachedTokens: 20,
          totalTokens: 200,
        },
      }),
    );
  });

  it('openai-compatible-provider records cached tokens and status: failed on error', async () => {
    const recordSpy = vi.spyOn(trackerModule, 'recordAiUsage').mockImplementation(() => {});

    const provider = new OpenAiCompatibleProvider({
      type: 'deepseek',
      apiKey: 'test-key',
      model: 'deepseek-chat',
    });

    // Mock failure
    (provider as any).client = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(new Error('Rate limit 429')),
        },
      },
    };

    const mockBudget = {
      reserve: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
    };

    await expect(
      provider.generateContent('hello', {
        budget: mockBudget as any,
        executionGuard: async () => {},
        orgId: 'org-test-2',
        taskType: 'copilot',
        signal: AbortSignal.abort(), // to prevent retry delay
      }),
    ).rejects.toThrow();

    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-test-2',
        taskType: 'copilot',
        provider: 'deepseek',
        model: 'deepseek-chat',
        status: 'failed',
      }),
    );
  });

  it('smart-hybrid-vision-bridge isolates onUsage and sets taskType to vision_ocr', async () => {
    const parentOnUsage = vi.fn();
    let childTaskType: string | undefined;
    let childOnUsage: any;

    const mockTargetProvider = {
      type: 'deepseek',
      supportsVision: false,
    } as any;

    const mockVisionProvider = {
      type: 'gemini',
      supportsVision: true,
      generateContent: vi.fn().mockImplementation(async (_prompt, opts) => {
        childTaskType = opts.taskType;
        childOnUsage = opts.onUsage;
        return 'OCR Extracted Text';
      }),
    } as any;

    const promptWithImage = [
      { inlineData: { mimeType: 'image/png', data: 'base64data' } },
    ];

    const processed = await preprocessMultimodalPrompt(
      promptWithImage,
      mockTargetProvider,
      mockVisionProvider,
      {
        budget: {} as any,
        executionGuard: async () => {},
        orgId: 'org-test-vision',
        taskType: 'executive_report',
        onUsage: parentOnUsage,
      },
    );

    expect(childTaskType).toBe('vision_ocr');
    // Parent onUsage must not have been passed to child
    expect(childOnUsage).toBeUndefined();
    expect(parentOnUsage).not.toHaveBeenCalled();
    expect(Array.isArray(processed)).toBe(true);
    expect((processed[0] as any).text).toContain('OCR Extracted Text');
  });

  it('testConnection returns token usage in TestConnectionResult', async () => {
    const provider = new GeminiProvider({
      type: 'gemini',
      apiKey: 'test-key',
      model: 'gemini-3.6-flash',
    });

    (provider as any).getClient = () => ({
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: 'pong',
          usageMetadata: {
            promptTokenCount: 1,
            candidatesTokenCount: 1,
            cachedContentTokenCount: 0,
            totalTokenCount: 2,
          },
        }),
      },
    });

    const result = await provider.testConnection();
    expect(result.success).toBe(true);
    expect(result.usage).toEqual({
      inputTokens: 1,
      outputTokens: 1,
      cachedTokens: 0,
      totalTokens: 2,
    });
  });
});
