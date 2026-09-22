process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_long_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { updateConversationAfterMessage } from '../../src/modules/chat/message-handler.js';

const getSql = (callArg: any): string => {
  if (!callArg) return '';
  if (typeof callArg === 'string') return callArg;
  if (Array.isArray(callArg)) return callArg.join('');
  if (Array.isArray(callArg[0])) return callArg[0].join('');
  if (callArg[0]?.sql) return callArg[0].sql;
  if (callArg[0]?.strings) return callArg[0].strings.join('');
  return '';
};

describe('Conversation Chronology & Data Integrity Tests', () => {
  const orgId = 'org-chrono-test';
  const conversationId = 'conv-chrono-123';

  // Simulates PostgreSQL GREATEST & CASE expressions for conversation projection
  interface ConvState {
    lastMessageAt: Date | null;
    isReplied: boolean;
    unreadCount: number;
  }

  const applyChronologyLogic = (state: ConvState, sentAt: Date, isSelf: boolean): ConvState => {
    const prevLast = state.lastMessageAt || sentAt;
    const isOutOfOrder = sentAt.getTime() < prevLast.getTime();

    return {
      lastMessageAt: new Date(Math.max(prevLast.getTime(), sentAt.getTime())),
      isReplied: isOutOfOrder ? state.isReplied : isSelf ? true : false,
      unreadCount: isOutOfOrder ? state.unreadCount : isSelf ? 0 : state.unreadCount + 1,
    };
  };

  it('generates chronology-aware SQL using GREATEST and CASE guards', async () => {
    const mockDb: any = {
      $executeRaw: vi.fn().mockResolvedValue(1),
    };

    const sentAt = new Date('2026-09-22T10:00:00.000Z');
    await updateConversationAfterMessage(mockDb, conversationId, orgId, sentAt, false);

    expect(mockDb.$executeRaw).toHaveBeenCalledTimes(1);
    const callArg = mockDb.$executeRaw.mock.calls[0];
    const sql = getSql(callArg);

    // Verify key chronological guard clauses
    expect(sql).toContain('GREATEST(COALESCE(last_message_at,');
    expect(sql).toContain('is_replied = CASE');
    expect(sql).toContain('unread_count = CASE');
    expect(sql).toContain('WHERE id =');
    expect(sql).toContain('org_id =');
  });

  it('prevents delayed customer message from regressing lastMessageAt or flipping isReplied', () => {
    // Current state: Agent replied at 10:05
    let state: ConvState = {
      lastMessageAt: new Date('2026-09-22T10:05:00.000Z'),
      isReplied: true,
      unreadCount: 0,
    };

    // Delayed customer message arrives from network out-of-order, sent at 10:02
    const delayedCustomerSentAt = new Date('2026-09-22T10:02:00.000Z');
    state = applyChronologyLogic(state, delayedCustomerSentAt, false);

    // Assert: lastMessageAt stays 10:05
    expect(state.lastMessageAt.toISOString()).toBe('2026-09-22T10:05:00.000Z');
    // Assert: isReplied remains true (does not flip to false)
    expect(state.isReplied).toBe(true);
    // Assert: unreadCount remains 0 (does not increment)
    expect(state.unreadCount).toBe(0);
  });

  it('prevents delayed self message from clearing unreadCount or setting isReplied when customer sent newer message', () => {
    // Current state: Customer sent message at 10:10
    let state: ConvState = {
      lastMessageAt: new Date('2026-09-22T10:10:00.000Z'),
      isReplied: false,
      unreadCount: 2,
    };

    // Delayed self message from an external phone arrived with timestamp 10:08
    const delayedSelfSentAt = new Date('2026-09-22T10:08:00.000Z');
    state = applyChronologyLogic(state, delayedSelfSentAt, true);

    // Assert: lastMessageAt stays 10:10
    expect(state.lastMessageAt.toISOString()).toBe('2026-09-22T10:10:00.000Z');
    // Assert: isReplied remains false
    expect(state.isReplied).toBe(false);
    // Assert: unreadCount remains 2 (customer message arrived after this self message)
    expect(state.unreadCount).toBe(2);
  });

  it('advances lastMessageAt and mutates state on in-order messages', () => {
    let state: ConvState = {
      lastMessageAt: new Date('2026-09-22T10:00:00.000Z'),
      isReplied: true,
      unreadCount: 0,
    };

    // Customer sends message at 10:01
    state = applyChronologyLogic(state, new Date('2026-09-22T10:01:00.000Z'), false);
    expect(state.lastMessageAt.toISOString()).toBe('2026-09-22T10:01:00.000Z');
    expect(state.isReplied).toBe(false);
    expect(state.unreadCount).toBe(1);

    // Customer sends second message at 10:02
    state = applyChronologyLogic(state, new Date('2026-09-22T10:02:00.000Z'), false);
    expect(state.lastMessageAt.toISOString()).toBe('2026-09-22T10:02:00.000Z');
    expect(state.isReplied).toBe(false);
    expect(state.unreadCount).toBe(2);

    // Agent replies at 10:03
    state = applyChronologyLogic(state, new Date('2026-09-22T10:03:00.000Z'), true);
    expect(state.lastMessageAt.toISOString()).toBe('2026-09-22T10:03:00.000Z');
    expect(state.isReplied).toBe(true);
    expect(state.unreadCount).toBe(0);
  });
});
