import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useChat } from '../src/composables/use-chat';

const { post, get } = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
}));

vi.mock('@/api/index', () => ({
  api: {
    post,
    get,
  },
}));

vi.mock('../src/composables/use-chat-copilot', () => ({
  useChatCopilot: () => ({
    clearSuggestion: vi.fn(),
  }),
}));

describe('Chat UI Client Idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockImplementation(async (url: string) => {
      if (url.includes('/messages')) {
        return { data: { messages: [] } };
      }
      return { data: { conversations: [] } };
    });
    post.mockResolvedValue({
      data: {
        id: 'msg-created-1',
        content: 'Hello',
        sentAt: '2026-09-22T00:00:00Z',
      },
    });
  });

  it('generates a unique clientMessageId UUID for each new send operation', async () => {
    const chat = useChat();
    chat.selectedConvId.value = 'conv-123';

    await chat.sendMessage('Message 1');
    await chat.sendMessage('Message 2');

    expect(post).toHaveBeenCalledTimes(2);

    const call1Payload = post.mock.calls[0][1];
    const call2Payload = post.mock.calls[1][1];

    expect(call1Payload.clientMessageId).toBeDefined();
    expect(call2Payload.clientMessageId).toBeDefined();

    // Verify UUID format: 8-4-4-4-12 hex characters
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(call1Payload.clientMessageId).toMatch(uuidRegex);
    expect(call2Payload.clientMessageId).toMatch(uuidRegex);

    // Each new send action must have a different clientMessageId
    expect(call1Payload.clientMessageId).not.toBe(call2Payload.clientMessageId);
  });

  it('reuses the clientMessageId when provided via options (e.g. automatic retry)', async () => {
    const chat = useChat();
    chat.selectedConvId.value = 'conv-123';

    const retryKey = '550e8400-e29b-41d4-a716-446655440000';
    await chat.sendMessage('Retry message', undefined, { clientMessageId: retryKey });

    expect(post).toHaveBeenCalledTimes(1);
    const payload = post.mock.calls[0][1];
    expect(payload.clientMessageId).toBe(retryKey);
  });
});
