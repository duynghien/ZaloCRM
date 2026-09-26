/**
 * quick-replies.test.ts — Unit tests for QuickReply service, validation, and conflict handling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sanitizeShortcut,
  validateQuickReplyInput,
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
  listQuickReplies,
  QuickReplyConflictError,
} from '../../src/modules/chat/quick-replies/quick-reply-service.js';
import { prisma } from '../../src/shared/database/prisma-client.js';
import { RequestValidationError } from '../../src/shared/http/request-schemas.js';

describe('QuickReply Validation & Service Unit Tests', () => {
  describe('sanitizeShortcut', () => {
    it('normalizes shortcuts: trims, lowercases, and removes leading slashes', () => {
      expect(sanitizeShortcut('/STK')).toBe('stk');
      expect(sanitizeShortcut('//diachi ')).toBe('diachi');
      expect(sanitizeShortcut('Bao_Gia-2026')).toBe('bao_gia-2026');
    });

    it('throws RequestValidationError if shortcut contains spaces or invalid characters', () => {
      expect(() => sanitizeShortcut('so tai khoan')).toThrow(RequestValidationError);
      expect(() => sanitizeShortcut('stk@techcombank')).toThrow(RequestValidationError);
      expect(() => sanitizeShortcut('')).toThrow(RequestValidationError);
      expect(() => sanitizeShortcut('///')).toThrow(RequestValidationError);
    });

    it('rejects shortcuts exceeding 50 characters', () => {
      const longShortcut = 'a'.repeat(51);
      expect(() => sanitizeShortcut(longShortcut)).toThrow(RequestValidationError);
    });
  });

  describe('validateQuickReplyInput', () => {
    it('enforces title <= 100 characters and non-empty', () => {
      expect(() => validateQuickReplyInput({ title: '' })).toThrow(RequestValidationError);
      expect(() => validateQuickReplyInput({ title: 'a'.repeat(101) })).toThrow(RequestValidationError);
      expect(() => validateQuickReplyInput({ title: 'STK Techcombank' })).not.toThrow();
    });

    it('enforces content <= 2000 characters and non-empty', () => {
      expect(() => validateQuickReplyInput({ content: '' })).toThrow(RequestValidationError);
      expect(() => validateQuickReplyInput({ content: 'x'.repeat(2001) })).toThrow(RequestValidationError);
      expect(() => validateQuickReplyInput({ content: 'x'.repeat(2000) })).not.toThrow();
    });

    it('validates allowed categories', () => {
      expect(() => validateQuickReplyInput({ category: 'invalid_cat' })).toThrow(RequestValidationError);
      expect(() => validateQuickReplyInput({ category: 'payment' })).not.toThrow();
      expect(() => validateQuickReplyInput({ category: 'general' })).not.toThrow();
    });
  });

  describe('Service Operations & Conflict Handling', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('creates a quick reply and handles P2002 conflict error by throwing QuickReplyConflictError (409)', async () => {
      vi.spyOn(prisma.quickReply, 'create').mockRejectedValue({
        code: 'P2002',
        message: 'Unique constraint failed on the fields: (`org_id`,`shortcut`)',
      });

      await expect(
        createQuickReply('org-1', 'user-1', {
          shortcut: 'stk',
          title: 'STK Ngân Hàng',
          content: 'Techcombank: 1903...',
          category: 'payment',
        })
      ).rejects.toThrow(QuickReplyConflictError);
    });

    it('creates a quick reply and emits socket event when io is provided', async () => {
      const mockCreated = {
        id: 'qr-123',
        orgId: 'org-1',
        shortcut: 'stk',
        title: 'STK Ngân Hàng',
        content: 'Techcombank: 1903...',
        category: 'payment',
        createdById: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: { id: 'user-1', fullName: 'Admin' },
      };

      vi.spyOn(prisma.quickReply, 'create').mockResolvedValue(mockCreated as any);

      const fakeSocket = { emit: vi.fn() };
      const fakeIo = {
        sockets: {
          adapter: {
            rooms: new Map([['org:org-1', new Set(['socket-1'])]]),
          },
          sockets: new Map([['socket-1', fakeSocket]]),
        },
      } as any;

      // Mock socket authorization checks
      const socketAuth = await import('../../src/shared/realtime/socket-authorization.js');
      vi.spyOn(socketAuth, 'currentSocketIdentity').mockResolvedValue({
        id: 'user-1',
        orgId: 'org-1',
        role: 'member',
      } as any);
      vi.spyOn(socketAuth, 'socketSessionIsCurrent').mockReturnValue(true);

      const result = await createQuickReply(
        'org-1',
        'user-1',
        {
          shortcut: 'stk',
          title: 'STK Ngân Hàng',
          content: 'Techcombank: 1903...',
          category: 'payment',
        },
        fakeIo
      );

      expect(result.id).toBe('qr-123');
      expect(fakeSocket.emit).toHaveBeenCalledWith('quick-reply:updated', { quickReply: mockCreated });
    });

    it('updates a quick reply and catches P2002 on shortcut change conflict', async () => {
      vi.spyOn(prisma.quickReply, 'findFirst').mockResolvedValue({
        id: 'qr-123',
        orgId: 'org-1',
        shortcut: 'stk_old',
      } as any);

      vi.spyOn(prisma.quickReply, 'update').mockRejectedValue({
        code: 'P2002',
        message: 'Unique constraint failed on the fields: (`org_id`,`shortcut`)',
      });

      await expect(
        updateQuickReply('org-1', 'qr-123', {
          shortcut: 'stk_existing',
        })
      ).rejects.toThrow(QuickReplyConflictError);
    });

    it('deletes a quick reply and emits quick-reply:deleted socket event', async () => {
      vi.spyOn(prisma.quickReply, 'findFirst').mockResolvedValue({
        id: 'qr-123',
        orgId: 'org-1',
      } as any);

      const deleteSpy = vi.spyOn(prisma.quickReply, 'delete').mockResolvedValue({ id: 'qr-123' } as any);

      const fakeSocket = { emit: vi.fn() };
      const fakeIo = {
        sockets: {
          adapter: {
            rooms: new Map([['org:org-1', new Set(['socket-1'])]]),
          },
          sockets: new Map([['socket-1', fakeSocket]]),
        },
      } as any;

      const socketAuth = await import('../../src/shared/realtime/socket-authorization.js');
      vi.spyOn(socketAuth, 'currentSocketIdentity').mockResolvedValue({
        id: 'user-1',
        orgId: 'org-1',
        role: 'member',
      } as any);
      vi.spyOn(socketAuth, 'socketSessionIsCurrent').mockReturnValue(true);

      const success = await deleteQuickReply('org-1', 'qr-123', fakeIo);
      expect(success).toBe(true);
      expect(deleteSpy).toHaveBeenCalledWith({ where: { id: 'qr-123' } });
      expect(fakeSocket.emit).toHaveBeenCalledWith('quick-reply:deleted', { id: 'qr-123' });
    });

    it('lists quick replies scoped to organization with search filter', async () => {
      const findSpy = vi.spyOn(prisma.quickReply, 'findMany').mockResolvedValue([]);

      await listQuickReplies('org-1', { category: 'pricing', search: 'vip' });

      expect(findSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            orgId: 'org-1',
            category: 'pricing',
            OR: [
              { shortcut: { contains: 'vip', mode: 'insensitive' } },
              { title: { contains: 'vip', mode: 'insensitive' } },
              { content: { contains: 'vip', mode: 'insensitive' } },
            ],
          }),
        })
      );
    });
  });
});
