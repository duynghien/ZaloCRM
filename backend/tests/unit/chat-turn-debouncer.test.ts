/**
 * chat-turn-debouncer.test.ts — Unit tests for ChatTurnDebouncer logic and race conditions.
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://crmuser:password@localhost:5432/zalocrm_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_long_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '../../src/shared/database/prisma-client.js';
import { ChatTurnDebouncer } from '../../src/modules/chat/copilot/chat-turn-debouncer.js';
import { chatCopilotService } from '../../src/modules/chat/copilot/chat-copilot-service.js';

describe('ChatTurnDebouncer', () => {
  let debouncer: ChatTurnDebouncer;
  let mockIo: any;

  beforeEach(() => {
    vi.useFakeTimers();
    debouncer = new ChatTurnDebouncer();
    mockIo = {
      sockets: {
        adapter: {
          rooms: new Map(),
        },
        sockets: new Map(),
      },
    };
    debouncer.init(mockIo);

    // Mock prisma queries used during execution
    vi.spyOn(prisma.appSetting, 'findUnique').mockResolvedValue(null);
    vi.spyOn(prisma.message, 'findMany').mockResolvedValue([]);
    vi.spyOn(prisma.conversation, 'findUnique').mockResolvedValue(null);
  });

  afterEach(() => {
    debouncer.cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('skips debouncing for group conversations', async () => {
    const spy = vi.spyOn(chatCopilotService, 'generateCopilotAnalysis');

    await debouncer.handleMessageTurn({
      conversationId: 'group-conv-1',
      accountId: 'acc-1',
      orgId: 'org-1',
      isSelf: false,
      threadType: 'group',
    });

    vi.advanceTimersByTime(5000);
    expect(spy).not.toHaveBeenCalled();
  });

  it('cancels pending timers when staff sends an outbound message (isSelf: true)', async () => {
    const spy = vi.spyOn(chatCopilotService, 'generateCopilotAnalysis');

    // Customer sends message
    await debouncer.handleMessageTurn({
      conversationId: 'user-conv-1',
      accountId: 'acc-1',
      orgId: 'org-1',
      isSelf: false,
      threadType: 'user',
    });

    // 1 second later, staff replies
    vi.advanceTimersByTime(1000);
    await debouncer.handleMessageTurn({
      conversationId: 'user-conv-1',
      accountId: 'acc-1',
      orgId: 'org-1',
      isSelf: true,
      threadType: 'user',
    });

    // Advance remaining time
    vi.advanceTimersByTime(5000);
    expect(spy).not.toHaveBeenCalled();
  });

  it('resets timer on rapid consecutive inbound messages and fires only once', async () => {
    const spy = vi.spyOn(chatCopilotService, 'generateCopilotAnalysis').mockResolvedValue(null);

    // Send 3 messages within debounce window
    await debouncer.handleMessageTurn({
      conversationId: 'user-conv-2',
      accountId: 'acc-1',
      orgId: 'org-1',
      isSelf: false,
      threadType: 'user',
    });

    vi.advanceTimersByTime(1000);
    await debouncer.handleMessageTurn({
      conversationId: 'user-conv-2',
      accountId: 'acc-1',
      orgId: 'org-1',
      isSelf: false,
      threadType: 'user',
    });

    vi.advanceTimersByTime(1000);
    await debouncer.handleMessageTurn({
      conversationId: 'user-conv-2',
      accountId: 'acc-1',
      orgId: 'org-1',
      isSelf: false,
      threadType: 'user',
    });

    // 2.9s after 3rd message - shouldn't have fired yet
    vi.advanceTimersByTime(2900);
    expect(spy).not.toHaveBeenCalled();

    // 3.1s after 3rd message - timer fires
    await vi.advanceTimersByTimeAsync(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
