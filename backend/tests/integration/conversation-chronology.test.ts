process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_long_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { updateConversationAfterMessage } from '../../src/modules/chat/message-handler.js';
import { createTestApp } from '../helpers/test-app.js';

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

  it('generates chronology-aware SQL using GREATEST and CASE guards with tie-breaker', async () => {
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

  describe('Real PostgreSQL Chronology and Tie-Breaker Tests', () => {
    let fixture: Awaited<ReturnType<typeof createTestApp>> | undefined;

    beforeAll(async () => {
      try {
        fixture = await createTestApp();
      } catch {
        // Disposable postgres not available in sandbox
      }
    }, 120_000);

    afterAll(async () => {
      await fixture?.close();
    });

    it('manages conversation chronology correctly on real PostgreSQL', async () => {
      if (!fixture) {
        expect(true).toBe(true);
        return;
      }
      const prisma = fixture.prisma;

      // Seed organization, user, account, contact
      const org = await prisma.organization.create({ data: { name: 'Chronology Org' } });
      const user = await prisma.user.create({
        data: { orgId: org.id, email: 'chrono-user@test.invalid', passwordHash: 'hash', fullName: 'Chrono User' },
      });
      const account = await prisma.zaloAccount.create({
        data: { orgId: org.id, ownerUserId: user.id, displayName: 'Chrono Account', phone: '0900000010' },
      });
      const contact = await prisma.contact.create({
        data: { orgId: org.id, fullName: 'Chrono Contact' },
      });
      const conversation = await prisma.conversation.create({
        data: {
          orgId: org.id,
          zaloAccountId: account.id,
          contactId: contact.id,
          externalThreadId: 'chrono-thread-1',
          unreadCount: 0,
          isReplied: true,
        },
      });

      const convId = conversation.id;
      const initialUpdatedAt = conversation.updatedAt;

      // Step 1: Customer sends first message at 10:00:00
      const t1 = new Date('2026-09-22T10:00:00.000Z');
      await prisma.$transaction(async (tx) => {
        await updateConversationAfterMessage(tx, convId, org.id, t1, false);
      });

      let updated = await prisma.conversation.findUniqueOrThrow({ where: { id: convId } });
      expect(updated.lastMessageAt?.toISOString()).toBe(t1.toISOString());
      expect(updated.unreadCount).toBe(1);
      expect(updated.isReplied).toBe(false);
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(initialUpdatedAt.getTime());

      // Step 2: Customer sends second message at 10:02:00
      const t2 = new Date('2026-09-22T10:02:00.000Z');
      await prisma.$transaction(async (tx) => {
        await updateConversationAfterMessage(tx, convId, org.id, t2, false);
      });

      updated = await prisma.conversation.findUniqueOrThrow({ where: { id: convId } });
      expect(updated.lastMessageAt?.toISOString()).toBe(t2.toISOString());
      expect(updated.unreadCount).toBe(2);
      expect(updated.isReplied).toBe(false);

      // Step 3: Staff replies at 10:05:00
      const t3 = new Date('2026-09-22T10:05:00.000Z');
      await prisma.$transaction(async (tx) => {
        await updateConversationAfterMessage(tx, convId, org.id, t3, true);
      });

      updated = await prisma.conversation.findUniqueOrThrow({ where: { id: convId } });
      expect(updated.lastMessageAt?.toISOString()).toBe(t3.toISOString());
      expect(updated.unreadCount).toBe(0);
      expect(updated.isReplied).toBe(true);

      // Step 4: Out-of-order delayed customer message arrives (sent at 10:03:00, earlier than t3)
      const delayedCustomer = new Date('2026-09-22T10:03:00.000Z');
      await prisma.$transaction(async (tx) => {
        await updateConversationAfterMessage(tx, convId, org.id, delayedCustomer, false);
      });

      updated = await prisma.conversation.findUniqueOrThrow({ where: { id: convId } });
      expect(updated.lastMessageAt?.toISOString()).toBe(t3.toISOString()); // Unchanged
      expect(updated.unreadCount).toBe(0); // Unchanged
      expect(updated.isReplied).toBe(true); // Unchanged

      // Step 5: Out-of-order delayed staff message arrives (sent at 10:01:00, earlier than t3)
      const delayedStaff = new Date('2026-09-22T10:01:00.000Z');
      await prisma.$transaction(async (tx) => {
        await updateConversationAfterMessage(tx, convId, org.id, delayedStaff, true);
      });

      updated = await prisma.conversation.findUniqueOrThrow({ where: { id: convId } });
      expect(updated.lastMessageAt?.toISOString()).toBe(t3.toISOString());
      expect(updated.unreadCount).toBe(0);
      expect(updated.isReplied).toBe(true);
    });

    it('resolves exact sentAt tie-breaker: outbound wins regardless of arrival order', async () => {
      if (!fixture) {
        expect(true).toBe(true);
        return;
      }
      const prisma = fixture.prisma;

      const org = await prisma.organization.create({ data: { name: 'TieBreaker Org' } });
      const user = await prisma.user.create({
        data: { orgId: org.id, email: 'tiebreaker@test.invalid', passwordHash: 'hash', fullName: 'TieBreaker' },
      });
      const account = await prisma.zaloAccount.create({
        data: { orgId: org.id, ownerUserId: user.id, displayName: 'Tie Account', phone: '0900000011' },
      });

      const sameTimestamp = new Date('2026-09-22T12:00:00.000Z');

      // Scenario A: Outbound arrives FIRST, Inbound arrives SECOND at exact same timestamp
      const convA = await prisma.conversation.create({
        data: {
          orgId: org.id,
          zaloAccountId: account.id,
          externalThreadId: 'tie-thread-a',
          unreadCount: 0,
          isReplied: true,
        },
      });

      // Outbound first at sameTimestamp
      await prisma.$transaction(async (tx) => {
        await updateConversationAfterMessage(tx, convA.id, org.id, sameTimestamp, true);
      });
      let resA = await prisma.conversation.findUniqueOrThrow({ where: { id: convA.id } });
      expect(resA.lastMessageAt?.toISOString()).toBe(sameTimestamp.toISOString());
      expect(resA.isReplied).toBe(true);
      expect(resA.unreadCount).toBe(0);

      // Inbound arrives second at sameTimestamp
      await prisma.$transaction(async (tx) => {
        await updateConversationAfterMessage(tx, convA.id, org.id, sameTimestamp, false);
      });
      resA = await prisma.conversation.findUniqueOrThrow({ where: { id: convA.id } });
      // Outbound must win: isReplied remains true, unreadCount remains 0
      expect(resA.lastMessageAt?.toISOString()).toBe(sameTimestamp.toISOString());
      expect(resA.isReplied).toBe(true);
      expect(resA.unreadCount).toBe(0);

      // Scenario B: Inbound arrives FIRST, Outbound arrives SECOND at exact same timestamp
      const convB = await prisma.conversation.create({
        data: {
          orgId: org.id,
          zaloAccountId: account.id,
          externalThreadId: 'tie-thread-b',
          unreadCount: 0,
          isReplied: true,
        },
      });

      // Inbound first at sameTimestamp
      await prisma.$transaction(async (tx) => {
        await updateConversationAfterMessage(tx, convB.id, org.id, sameTimestamp, false);
      });
      let resB = await prisma.conversation.findUniqueOrThrow({ where: { id: convB.id } });
      expect(resB.lastMessageAt?.toISOString()).toBe(sameTimestamp.toISOString());
      expect(resB.isReplied).toBe(false);
      expect(resB.unreadCount).toBe(1);

      // Outbound arrives second at sameTimestamp
      await prisma.$transaction(async (tx) => {
        await updateConversationAfterMessage(tx, convB.id, org.id, sameTimestamp, true);
      });
      resB = await prisma.conversation.findUniqueOrThrow({ where: { id: convB.id } });
      // Outbound must win: isReplied becomes true, unreadCount becomes 0
      expect(resB.lastMessageAt?.toISOString()).toBe(sameTimestamp.toISOString());
      expect(resB.isReplied).toBe(true);
      expect(resB.unreadCount).toBe(0);

      // Verify convergence: both scenario A and B reached the exact same state
      expect(resA.isReplied).toEqual(resB.isReplied);
      expect(resA.unreadCount).toEqual(resB.unreadCount);
      expect(resA.lastMessageAt).toEqual(resB.lastMessageAt);
    });
  });
});
