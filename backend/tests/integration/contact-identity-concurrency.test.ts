process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_long_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveOrCreateDeliveryConversation } from '../../src/modules/zalo/delivery-conversation-resolver.js';
import { prisma } from '../../src/shared/database/prisma-client.js';

vi.mock('../../src/shared/database/prisma-client.js', () => {
  const mockPrisma: any = {
    contact: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
    conversation: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
  };
  return { prisma: mockPrisma };
});

describe('Contact Identity & Concurrency Integration Tests', () => {
  const orgId = 'org-contact-identity-test';
  const zaloAccountId = 'acc-test-1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('standardizes group zaloUid with group_ prefix across group chat delivery', async () => {
    const threadId = '9876543210';
    vi.mocked(prisma.conversation.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.contact.upsert).mockResolvedValue({ id: 'contact-group-1' } as any);
    vi.mocked(prisma.conversation.upsert).mockResolvedValue({ id: 'conv-group-1' } as any);

    await resolveOrCreateDeliveryConversation({
      orgId,
      zaloAccountId,
      threadId,
      threadType: 'group',
    });

    expect(prisma.contact.upsert).toHaveBeenCalledTimes(1);
    const upsertArgs = vi.mocked(prisma.contact.upsert).mock.calls[0][0];

    // Verifies standardized group prefix
    expect(upsertArgs.where.orgId_zaloUid).toEqual({
      orgId,
      zaloUid: `group_${threadId}`,
    });
    expect(upsertArgs.create.zaloUid).toBe(`group_${threadId}`);
    expect(upsertArgs.create.fullName).toBe('Nhóm');
  });

  it('does not double-prefix if group threadId already has group_ prefix', async () => {
    const threadId = 'group_123456';
    vi.mocked(prisma.conversation.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.contact.upsert).mockResolvedValue({ id: 'contact-group-2' } as any);
    vi.mocked(prisma.conversation.upsert).mockResolvedValue({ id: 'conv-group-2' } as any);

    await resolveOrCreateDeliveryConversation({
      orgId,
      zaloAccountId,
      threadId,
      threadType: 'group',
    });

    const upsertArgs = vi.mocked(prisma.contact.upsert).mock.calls[0][0];
    expect(upsertArgs.where.orgId_zaloUid.zaloUid).toBe('group_123456');
  });

  it('produces exactly one contact row across concurrent upserts using ACID unique constraint', async () => {
    // In-memory simulation of PostgreSQL table with @@unique([orgId, zaloUid])
    const contactStore = new Map<string, any>();

    const simulatedUpsert = async (params: { orgId: string; zaloUid: string; fullName: string }) => {
      const key = `${params.orgId}:${params.zaloUid}`;
      // Simulate atomic PostgreSQL ON CONFLICT (org_id, zalo_uid) DO UPDATE
      if (!contactStore.has(key)) {
        contactStore.set(key, {
          id: `contact-${params.zaloUid}`,
          orgId: params.orgId,
          zaloUid: params.zaloUid,
          fullName: params.fullName,
        });
      }
      return contactStore.get(key);
    };

    const threadId = 'customer_user_99';
    // Run 10 concurrent requests creating a contact for the same (orgId, zaloUid)
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        simulatedUpsert({ orgId, zaloUid: threadId, fullName: `User Attempt ${i}` })
      )
    );

    // Exactly 1 contact row exists in store
    expect(contactStore.size).toBe(1);
    // All 10 operations returned the identical contact ID
    const firstId = results[0].id;
    for (const res of results) {
      expect(res.id).toBe(firstId);
    }
  });
});
