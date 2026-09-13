import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest';
import { createTestApp } from '../helpers/test-app.js';

let fixture: Awaited<ReturnType<typeof createTestApp>>;
let handler: typeof import('../../src/modules/chat/message-handler.js');

beforeAll(async () => {
  fixture = await createTestApp();
  handler = await import('../../src/modules/chat/message-handler.js');
}, 120_000);

afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await fixture?.close(); });

async function account() {
  const org = await fixture.prisma.organization.create({ data: { name: 'Self Listen Sync Org' } });
  const owner = await fixture.prisma.user.create({
    data: { orgId: org.id, role: 'owner', email: `${randomUUID()}@test.invalid`, fullName: 'Nguyễn Văn Chủ', passwordHash: 'unused' },
  });
  const zaloAccount = await fixture.prisma.zaloAccount.create({
    data: { orgId: org.id, ownerUserId: owner.id, displayName: 'Zalo Chủ Shop', zaloUid: `shop-owner-${randomUUID()}` },
  });
  return { org, owner, zaloAccount };
}

it('syncs outbound self-message from external device with correct recipient contact and replied status', async () => {
  const { zaloAccount } = await account();
  const threadId = randomUUID();
  const msgId = randomUUID();

  const res = await handler.handleIncomingMessage({
    accountId: zaloAccount.id, senderUid: zaloAccount.zaloUid || 'shop-owner-uid',
    senderName: 'Zalo Chủ Shop', recipientName: 'Khách Hàng VIP', recipientAvatar: 'https://avatar.example/vip.png',
    content: 'Tin nhắn gửi từ iPad', contentType: 'text', msgId, timestamp: Date.now(), isSelf: true, threadId, threadType: 'user',
  });

  expect(res).not.toBeNull();
  expect(res!.contactId).not.toBeNull();
  const conversation = await fixture.prisma.conversation.findUniqueOrThrow({ where: { id: res!.conversationId } });
  expect(conversation.contactId).toBe(res!.contactId);
  expect(conversation.isReplied).toBe(true);
  expect(conversation.unreadCount).toBe(0);

  const contact = await fixture.prisma.contact.findUniqueOrThrow({ where: { id: res!.contactId! } });
  expect(contact.fullName).toBe('Khách Hàng VIP');
  expect(contact.avatarUrl).toBe('https://avatar.example/vip.png');
  expect(contact.firstContactDate).toBeInstanceOf(Date);
});

it('self-heals conversation with previously null contactId when new message arrives', async () => {
  const { org, zaloAccount } = await account();
  const threadId = randomUUID();

  const conv = await fixture.prisma.conversation.create({
    data: { id: randomUUID(), orgId: org.id, zaloAccountId: zaloAccount.id, externalThreadId: threadId, threadType: 'user', contactId: null, lastMessageAt: new Date() },
  });
  expect(conv.contactId).toBeNull();

  const res = await handler.handleIncomingMessage({
    accountId: zaloAccount.id, senderUid: zaloAccount.zaloUid || 'shop-owner-uid',
    senderName: 'Zalo Chủ Shop', recipientName: 'Khách Tự Lành', content: 'Tự lành hội thoại',
    contentType: 'text', msgId: randomUUID(), timestamp: Date.now(), isSelf: true, threadId, threadType: 'user',
  });

  expect(res).not.toBeNull();
  expect(res!.conversationId).toBe(conv.id);
  const updatedConv = await fixture.prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
  expect(updatedConv.contactId).toBe(res!.contactId);
});

it('deduplicates duplicate messages having identical zaloMsgId', async () => {
  const { zaloAccount } = await account();
  const threadId = randomUUID();
  const msgId = randomUUID();
  const payload = {
    accountId: zaloAccount.id, senderUid: zaloAccount.zaloUid || 'shop-owner-uid',
    senderName: 'Zalo Chủ Shop', content: 'Tin nhắn gửi 1 lần', contentType: 'text',
    msgId, timestamp: Date.now(), isSelf: true, threadId, threadType: 'user' as const,
  };

  const first = await handler.handleIncomingMessage(payload);
  expect(first).not.toBeNull();
  const second = await handler.handleIncomingMessage(payload);
  expect(second).toBeNull();

  const count = await fixture.prisma.message.count({ where: { conversationId: first!.conversationId, zaloMsgId: msgId } });
  expect(count).toBe(1);
});

it('marks self message as deleted when receiving undo from external device', async () => {
  const { zaloAccount } = await account();
  const threadId = randomUUID();
  const msgId = randomUUID();

  const saved = await handler.handleIncomingMessage({
    accountId: zaloAccount.id, senderUid: zaloAccount.zaloUid || 'shop-owner-uid',
    senderName: 'Zalo Chủ Shop', content: 'Tin nhắn sắp bị thu hồi', contentType: 'text',
    msgId, timestamp: Date.now(), isSelf: true, threadId, threadType: 'user',
  });
  expect(saved).not.toBeNull();

  const undoConvId = await handler.handleMessageUndo(zaloAccount.id, msgId, threadId);
  expect(undoConvId).toBe(saved!.conversationId);
  const msg = await fixture.prisma.message.findUniqueOrThrow({ where: { id: saved!.message.id } });
  expect(msg.isDeleted).toBe(true);
  expect(msg.deletedAt).toBeInstanceOf(Date);
});

it('self-heals fallback contact name when customer later replies with real name', async () => {
  const { zaloAccount } = await account();
  const threadId = randomUUID();

  const outbound = await handler.handleIncomingMessage({
    accountId: zaloAccount.id, senderUid: zaloAccount.zaloUid || 'shop-owner-uid',
    senderName: 'Zalo Chủ Shop', content: 'Chào bạn', contentType: 'text',
    msgId: randomUUID(), timestamp: Date.now(), isSelf: true, threadId, threadType: 'user',
  });
  expect(outbound).not.toBeNull();
  let contact = await fixture.prisma.contact.findUniqueOrThrow({ where: { id: outbound!.contactId! } });
  expect(contact.fullName).toBe('Khách Zalo');

  const inbound = await handler.handleIncomingMessage({
    accountId: zaloAccount.id, senderUid: threadId, senderName: 'Trần Thị Thu Thảo',
    content: 'Dạ em chào anh', contentType: 'text', msgId: randomUUID(),
    timestamp: Date.now() + 1000, isSelf: false, threadId, threadType: 'user',
  });
  expect(inbound).not.toBeNull();
  contact = await fixture.prisma.contact.findUniqueOrThrow({ where: { id: outbound!.contactId! } });
  expect(contact.fullName).toBe('Trần Thị Thu Thảo');
});

it('syncs group chat message from external device without customer recipient lookup', async () => {
  const { zaloAccount } = await account();
  const threadId = randomUUID();
  const msgId = randomUUID();

  const res = await handler.handleIncomingMessage({
    accountId: zaloAccount.id, senderUid: zaloAccount.zaloUid || 'shop-owner-uid',
    senderName: 'Zalo Chủ Shop', content: 'Tin nhắn trong nhóm chat', contentType: 'text',
    msgId, timestamp: Date.now(), isSelf: true, threadId, threadType: 'group', groupName: 'Nhóm Khách Hàng Thân Thiết',
  });

  expect(res).not.toBeNull();
  const conversation = await fixture.prisma.conversation.findUniqueOrThrow({ where: { id: res!.conversationId } });
  expect(conversation.threadType).toBe('group');
  const groupContact = await fixture.prisma.contact.findUniqueOrThrow({ where: { id: res!.contactId! } });
  expect(groupContact.fullName).toBe('Nhóm Khách Hàng Thân Thiết');
});
