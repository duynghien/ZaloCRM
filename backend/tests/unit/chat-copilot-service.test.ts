/**
 * chat-copilot-service.test.ts — Unit tests for Copilot Engine components.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ChatCopilotPromptBuilder } from '../../src/modules/chat/copilot/chat-copilot-prompt-builder.js';
import { ChatCopilotCache } from '../../src/modules/chat/copilot/chat-copilot-cache.js';
import { parseRawCopilotJson, normalizeCopilotResult } from '../../src/modules/chat/copilot/chat-copilot-parser.js';
import type { CopilotAnalysisResult } from '../../src/modules/chat/copilot/chat-copilot-types.js';

describe('ChatCopilotPromptBuilder', () => {
  it('wraps customer messages in XML tags and escapes sensitive XML chars', () => {
    const prompt = ChatCopilotPromptBuilder.buildUserPrompt(
      'conv-123',
      [
        {
          id: 'msg-1',
          senderType: 'contact',
          senderName: 'Nguyen Van A',
          content: 'Giá bao nhiêu & có ship <COD> không?',
          contentType: 'text',
          sentAt: '2026-09-17T10:00:00.000Z',
        },
      ],
      { fullName: 'Nguyen Van A', phone: '0901234567' },
      false,
    );

    expect(prompt).toContain('<customer_utterance id="msg-1" sender="Nguyen Van A" type="contact"');
    expect(prompt).toContain('Giá bao nhiêu &amp; có ship &lt;COD&gt; không?');
    expect(prompt).toContain('</customer_utterance>');
    expect(prompt).toContain('HỒ SƠ KHÁCH HÀNG:');
    expect(prompt).toContain('0901234567');
  });

  it('converts image-only messages to [Khách gửi hình ảnh]', () => {
    const prompt = ChatCopilotPromptBuilder.buildUserPrompt(
      'conv-123',
      [
        {
          id: 'msg-2',
          senderType: 'contact',
          content: '',
          contentType: 'image',
          sentAt: '2026-09-17T10:00:00.000Z',
        },
      ],
      null,
      false,
    );

    expect(prompt).toContain('[Khách gửi hình ảnh]');
  });

  it('injects business context into system instruction', () => {
    const sys = ChatCopilotPromptBuilder.buildSystemInstruction('Kem nám: 450.000đ/hộp. Sữa rửa mặt: 200.000đ.');
    expect(sys).toContain('Kem nám: 450.000đ/hộp');
    expect(sys).toContain('QUY TẮC BẢNG GIÁ: Tuyệt đối KHÔNG tự ý bịa ra mức giá mới');
  });
});

describe('ChatCopilotCache', () => {
  let cache: ChatCopilotCache;

  beforeEach(() => {
    cache = new ChatCopilotCache(3, 1000); // Max 3 items, 1s TTL
  });

  it('stores, retrieves, and handles cache hits/misses', () => {
    const sample: CopilotAnalysisResult = {
      conversationId: 'c1',
      analyzedAt: new Date().toISOString(),
      insights: {
        sentiment: 'positive',
        sentimentScore: 80,
        buyingIntent: 'ready_to_buy',
        intentConfidence: 0.9,
        customerSummary: 'Muốn mua kem nám',
      },
      smartReplies: [],
      quickDraft: { hasActionableData: false },
      anomalyAlert: { triggered: false, severity: 'low' },
    };

    cache.set('c1:m1', sample);
    expect(cache.has('c1:m1')).toBe(true);
    expect(cache.get('c1:m1')?.insights.sentiment).toBe('positive');
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('evicts oldest entry when max capacity is reached (LRU)', () => {
    const makeRes = (id: string): CopilotAnalysisResult => ({
      conversationId: id,
      analyzedAt: new Date().toISOString(),
      insights: { sentiment: 'neutral', sentimentScore: 50, buyingIntent: 'none', intentConfidence: 0.5, customerSummary: '' },
      smartReplies: [],
      quickDraft: { hasActionableData: false },
      anomalyAlert: { triggered: false, severity: 'low' },
    });

    cache.set('k1', makeRes('k1'));
    cache.set('k2', makeRes('k2'));
    cache.set('k3', makeRes('k3'));
    expect(cache.size).toBe(3);

    // Adding 4th item should evict oldest (k1)
    cache.set('k4', makeRes('k4'));
    expect(cache.size).toBe(3);
    expect(cache.get('k1')).toBeNull();
    expect(cache.get('k2')).not.toBeNull();
    expect(cache.get('k4')).not.toBeNull();
  });
});

describe('ChatCopilotParser', () => {
  it('parses direct JSON and extracts from markdown codeblocks', () => {
    const rawDirect = '{"insights": {"sentiment": "curious"}}';
    expect(parseRawCopilotJson(rawDirect)).toEqual({ insights: { sentiment: 'curious' } });

    const rawMarkdown = 'Dưới đây là kết quả:\n```json\n{"insights": {"sentiment": "frustrated"}}\n```\nChúc bạn thành công!';
    expect(parseRawCopilotJson(rawMarkdown)).toEqual({ insights: { sentiment: 'frustrated' } });

    const rawMessy = 'Text trước {"insights": {"sentiment": "angry"}} text sau';
    expect(parseRawCopilotJson(rawMessy)).toEqual({ insights: { sentiment: 'angry' } });
  });

  it('normalizes incomplete output with safe defaults', () => {
    const incomplete = {
      insights: { sentiment: 'invalid_sentiment' },
      smartReplies: [{ content: 'Dạ em chào anh/chị!' }],
      anomalyAlert: { triggered: true, severity: 'critical', reason: 'Khách đòi kiện' },
    };

    const res = normalizeCopilotResult('conv-test', incomplete);
    expect(res).not.toBeNull();
    expect(res?.conversationId).toBe('conv-test');
    expect(res?.insights.sentiment).toBe('neutral'); // Fallback from invalid
    expect(res?.insights.sentimentScore).toBe(50);
    expect(res?.smartReplies.length).toBe(1);
    expect(res?.smartReplies[0].content).toBe('Dạ em chào anh/chị!');
    expect(res?.anomalyAlert.triggered).toBe(true);
    expect(res?.anomalyAlert.severity).toBe('critical');
    expect(res?.anomalyAlert.reason).toBe('Khách đòi kiện');
    expect(res?.quickDraft.hasActionableData).toBe(false);
  });
});

describe('callCopilotAiProvider SSRF Protection', () => {
  it('blocks private IP / localhost baseURL for OpenAI-compatible providers', async () => {
    const { callCopilotAiProvider } = await import('../../src/modules/chat/copilot/chat-copilot-ai-caller.js');
    await expect(
      callCopilotAiProvider(
        'openai',
        { apiKey: 'sk-test', baseUrl: 'http://127.0.0.1:11434' },
        'instruction',
        'prompt',
      ),
    ).rejects.toThrow();

    await expect(
      callCopilotAiProvider(
        'deepseek',
        { apiKey: 'sk-test', baseUrl: 'http://192.168.1.100:8000' },
        'instruction',
        'prompt',
      ),
    ).rejects.toThrow();
  });
});
