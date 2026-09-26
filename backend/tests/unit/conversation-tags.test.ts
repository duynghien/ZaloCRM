/**
 * conversation-tags.test.ts — Unit tests for Conversation Tag service, validation, and multi-tenant isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateTagInput,
  createConversationTag,
  updateConversationTag,
  deleteConversationTag,
  assignTagToConversation,
  unassignTagFromConversation,
  ConversationTagConflictError,
  ConversationTagLimitError,
  MAX_TAGS_PER_CONVERSATION,
} from '../../src/modules/chat/tags/conversation-tag-service.js';
import { prisma } from '../../src/shared/database/prisma-client.js';
import { RequestValidationError } from '../../src/shared/http/request-schemas.js';

describe('Conversation Tags & Assignments Unit Tests', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    const socketAuth = await import('../../src/shared/realtime/socket-authorization.js');
    vi.spyOn(socketAuth, 'currentSocketIdentity').mockResolvedValue({
      id: 'user-1',
      orgId: 'org-1',
      role: 'member',
    } as any);
    vi.spyOn(socketAuth, 'socketSessionIsCurrent').mockReturnValue(true);
  });

  describe('validateTagInput', () => {
    it('validates tag name (1-50 chars, non-empty)', () => {
      expect(() => validateTagInput({ name: '' })).toThrow(RequestValidationError);
      expect(() => validateTagInput({ name: '   ' })).toThrow(RequestValidationError);
      expect(() => validateTagInput({ name: 'a'.repeat(51) })).toThrow(RequestValidationError);
      expect(() => validateTagInput({ name: 'VIP Khách hàng' })).not.toThrow();
    });

    it('validates tag color (1-30 chars, non-empty)', () => {
      expect(() => validateTagInput({ color: '' })).toThrow(RequestValidationError);
      expect(() => validateTagInput({ color: '   ' })).toThrow(RequestValidationError);
      expect(() => validateTagInput({ color: 'c'.repeat(31) })).toThrow(RequestValidationError);
      expect(() => validateTagInput({ color: '#10B981' })).not.toThrow();
    });

    it('validates description (<= 200 chars)', () => {
      expect(() => validateTagInput({ description: 'd'.repeat(201) })).toThrow(RequestValidationError);
      expect(() => validateTagInput({ description: 'Hội thoại cần chốt cọc sớm' })).not.toThrow();
    });
  });

  describe('CRUD operations & Conflict Handling', () => {
    it('creates a tag and throws ConversationTagConflictError on duplicate name (P2002)', async () => {
      vi.spyOn(prisma.conversationTag, 'create').mockRejectedValue({
        code: 'P2002',
        message: 'Unique constraint failed on the fields: (`org_id`,`name`)',
      });

      await expect(
        createConversationTag('org-1', {
          name: 'Đã chốt',
          color: '#10B981',
        })
      ).rejects.toThrow(ConversationTagConflictError);
    });

    it('creates a tag successfully', async () => {
      const mockTag = {
        id: 'tag-1',
        orgId: 'org-1',
        name: 'Đã chốt',
        color: '#10B981',
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { assignments: 0 },
      };
      vi.spyOn(prisma.conversationTag, 'create').mockResolvedValue(mockTag as any);

      const res = await createConversationTag('org-1', {
        name: 'Đã chốt',
        color: '#10B981',
      });
      expect(res.id).toBe('tag-1');
      expect(res.name).toBe('Đã chốt');
    });

    it('updates a tag and returns null if not found in org', async () => {
      vi.spyOn(prisma.conversationTag, 'findFirst').mockResolvedValue(null);

      const res = await updateConversationTag('org-1', 'tag-not-found', {
        name: 'Đổi tên',
      });
      expect(res).toBeNull();
    });

    it('deletes a tag and emits conversation:tag-deleted to org room', async () => {
      vi.spyOn(prisma.conversationTag, 'findFirst').mockResolvedValue({ id: 'tag-1', orgId: 'org-1' } as any);
      vi.spyOn(prisma.conversationTag, 'delete').mockResolvedValue({ id: 'tag-1' } as any);

      const fakeSocket = { emit: vi.fn() };
      const fakeIo = {
        sockets: {
          adapter: {
            rooms: new Map([['org:org-1', new Set(['socket-1'])]]),
          },
          sockets: new Map([['socket-1', fakeSocket]]),
        },
      } as any;

      const success = await deleteConversationTag('org-1', 'tag-1', fakeIo);
      expect(success).toBe(true);
      expect(fakeSocket.emit).toHaveBeenCalledWith(
        'conversation:tag-deleted',
        expect.objectContaining({ tagId: 'tag-1' })
      );
    });
  });

  describe('Tag Assignments & Quota Limit (max 6)', () => {
    it('returns null if conversation does not exist or belongs to different org', async () => {
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue(null);

      const res = await assignTagToConversation('org-1', 'conv-1', 'tag-1', 'user-1');
      expect(res).toBeNull();
    });

    it('throws RequestValidationError if tag does not exist in org', async () => {
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-1', orgId: 'org-1' } as any);
      vi.spyOn(prisma.conversationTag, 'findFirst').mockResolvedValue(null);

      await expect(
        assignTagToConversation('org-1', 'conv-1', 'tag-1', 'user-1')
      ).rejects.toThrow(RequestValidationError);
    });

    it('is idempotent: returns current tags if already assigned without error', async () => {
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-1', orgId: 'org-1' } as any);
      vi.spyOn(prisma.conversationTag, 'findFirst').mockResolvedValue({ id: 'tag-1', orgId: 'org-1' } as any);
      const existing = [
        { orgId: 'org-1', conversationId: 'conv-1', tagId: 'tag-1', tag: { id: 'tag-1', name: 'VIP' } },
      ];
      vi.spyOn(prisma.conversationTagAssignment, 'findMany').mockResolvedValue(existing as any);
      const createSpy = vi.spyOn(prisma.conversationTagAssignment, 'create');

      const res = await assignTagToConversation('org-1', 'conv-1', 'tag-1', 'user-1');
      expect(res).toEqual(existing);
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('enforces maximum 6 tags per conversation and throws ConversationTagLimitError', async () => {
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-1', orgId: 'org-1' } as any);
      vi.spyOn(prisma.conversationTag, 'findFirst').mockResolvedValue({ id: 'tag-7', orgId: 'org-1' } as any);

      // Simulate 6 already assigned tags
      const sixTags = Array.from({ length: MAX_TAGS_PER_CONVERSATION }).map((_, i) => ({
        orgId: 'org-1',
        conversationId: 'conv-1',
        tagId: `tag-${i + 1}`,
        tag: { id: `tag-${i + 1}`, name: `Tag ${i + 1}` },
      }));
      vi.spyOn(prisma.conversationTagAssignment, 'findMany').mockResolvedValue(sixTags as any);

      await expect(
        assignTagToConversation('org-1', 'conv-1', 'tag-7', 'user-1')
      ).rejects.toThrow(ConversationTagLimitError);
    });

    it('successfully assigns tag and emits conversation:tags-updated event', async () => {
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-1', orgId: 'org-1' } as any);
      vi.spyOn(prisma.conversationTag, 'findFirst').mockResolvedValue({ id: 'tag-1', orgId: 'org-1' } as any);

      vi.spyOn(prisma.conversationTagAssignment, 'findMany')
        .mockResolvedValueOnce([]) // Initially 0 tags
        .mockResolvedValueOnce([
          { orgId: 'org-1', conversationId: 'conv-1', tagId: 'tag-1', tag: { id: 'tag-1', name: 'VIP', color: '#EF4444' } },
        ] as any);

      vi.spyOn(prisma.conversationTagAssignment, 'create').mockResolvedValue({} as any);

      const fakeSocket = { emit: vi.fn() };
      const fakeIo = {
        sockets: {
          adapter: {
            rooms: new Map([['org:org-1', new Set(['socket-1'])]]),
          },
          sockets: new Map([['socket-1', fakeSocket]]),
        },
      } as any;

      const res = await assignTagToConversation('org-1', 'conv-1', 'tag-1', 'user-1', fakeIo);
      expect(res).toHaveLength(1);
      expect(fakeSocket.emit).toHaveBeenCalledWith(
        'conversation:tags-updated',
        expect.objectContaining({
          conversationId: 'conv-1',
          tags: expect.arrayContaining([expect.objectContaining({ tagId: 'tag-1' })]),
        })
      );
    });

    it('unassigns tag and emits conversation:tags-updated event', async () => {
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-1', orgId: 'org-1' } as any);
      vi.spyOn(prisma.conversationTagAssignment, 'deleteMany').mockResolvedValue({ count: 1 } as any);
      vi.spyOn(prisma.conversationTagAssignment, 'findMany').mockResolvedValue([]);

      const fakeSocket = { emit: vi.fn() };
      const fakeIo = {
        sockets: {
          adapter: {
            rooms: new Map([['org:org-1', new Set(['socket-1'])]]),
          },
          sockets: new Map([['socket-1', fakeSocket]]),
        },
      } as any;

      const res = await unassignTagFromConversation('org-1', 'conv-1', 'tag-1', fakeIo);
      expect(res).toHaveLength(0);
      expect(fakeSocket.emit).toHaveBeenCalledWith(
        'conversation:tags-updated',
        expect.objectContaining({
          conversationId: 'conv-1',
          tags: [],
        })
      );
    });
  });
});
