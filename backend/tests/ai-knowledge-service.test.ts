import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listKnowledgeRules,
  createKnowledgeRule,
  updateKnowledgeRule,
  deleteKnowledgeRule,
  toggleKnowledgeRule,
  getDistinctBranchTags,
  KnowledgeValidationError,
} from '../src/modules/ai-reports/knowledge/ai-knowledge-service.js';
import { prisma } from '../src/shared/database/prisma-client.js';

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: {
    aiKnowledgeRule: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    zaloAccount: {
      findMany: vi.fn(),
    },
  },
}));

describe('ai-knowledge-service', () => {
  const orgId = 'org-tenant-1';
  const otherOrgId = 'org-tenant-2';
  const userId = 'user-admin-1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listKnowledgeRules', () => {
    it('queries rules scoped strictly to orgId and ordered by createdAt desc', async () => {
      const mockRules = [
        { id: 'rule-1', orgId, title: 'Rule 1', ruleContent: 'Content 1', content: 'Content 1', scope: 'org' },
      ];
      vi.mocked(prisma.aiKnowledgeRule.findMany).mockResolvedValueOnce(mockRules as any);

      const result = await listKnowledgeRules(orgId, {
        scope: 'org',
        category: 'sop',
        isActive: true,
        search: 'bếp',
      });

      expect(prisma.aiKnowledgeRule.findMany).toHaveBeenCalledWith({
        where: {
          orgId,
          scope: 'org',
          category: 'sop',
          isActive: true,
          OR: [
            { title: { contains: 'bếp', mode: 'insensitive' } },
            { ruleContent: { contains: 'bếp', mode: 'insensitive' } },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(mockRules);
    });

    it('filters correctly by branchTag and groupThreadId', async () => {
      vi.mocked(prisma.aiKnowledgeRule.findMany).mockResolvedValueOnce([]);

      await listKnowledgeRules(orgId, {
        branchTag: 'CN1',
        groupThreadId: 'thread-123',
      });

      expect(prisma.aiKnowledgeRule.findMany).toHaveBeenCalledWith({
        where: {
          orgId,
          branchTag: 'CN1',
          groupThreadId: 'thread-123',
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('createKnowledgeRule', () => {
    it('creates an org-level knowledge rule successfully', async () => {
      const created = {
        id: 'rule-new',
        orgId,
        scope: 'org',
        category: 'terminology',
        title: 'Thuật ngữ OD',
        ruleContent: 'OD là Order khách gọi tại bàn',
        content: 'OD là Order khách gọi tại bàn',
        isActive: true,
      };
      vi.mocked(prisma.aiKnowledgeRule.create).mockResolvedValueOnce(created as any);

      const result = await createKnowledgeRule(orgId, userId, {
        title: '  Thuật ngữ OD  ',
        ruleContent: 'OD là Order khách gọi tại bàn',
        category: 'terminology',
        scope: 'org',
      });

      expect(prisma.aiKnowledgeRule.create).toHaveBeenCalledWith({
        data: {
          orgId,
          createdById: userId,
          scope: 'org',
          branchTag: null,
          groupThreadId: null,
          zaloAccountId: null,
          category: 'terminology',
          title: 'Thuật ngữ OD',
          ruleContent: 'OD là Order khách gọi tại bàn',
          isActive: true,
          sourceReportId: null,
        },
      });
      expect(result).toEqual(created);
    });

    it('creates a rule using content alias (frontend input format)', async () => {
      const created = {
        id: 'rule-from-content',
        orgId,
        scope: 'org',
        category: 'sop',
        title: 'Quy trình mở ca',
        ruleContent: 'Mở ca lúc 7h30',
        content: 'Mở ca lúc 7h30',
        isActive: true,
      };
      vi.mocked(prisma.aiKnowledgeRule.create).mockResolvedValueOnce(created as any);

      const result = await createKnowledgeRule(orgId, userId, {
        title: 'Quy trình mở ca',
        content: 'Mở ca lúc 7h30',
        category: 'sop',
        scope: 'org',
      });

      expect(prisma.aiKnowledgeRule.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: 'Quy trình mở ca',
          ruleContent: 'Mở ca lúc 7h30',
        }),
      });
      expect(result.content).toBe('Mở ca lúc 7h30');
      expect(result.ruleContent).toBe('Mở ca lúc 7h30');
    });

    it('creates a branch-level rule with valid branchTag', async () => {
      vi.mocked(prisma.aiKnowledgeRule.create).mockResolvedValueOnce({ id: 'rule-branch' } as any);

      await createKnowledgeRule(orgId, userId, {
        title: 'Giờ mở cửa CN2',
        ruleContent: 'Mở cửa từ 7h đến 23h',
        scope: 'branch',
        branchTag: 'CN2',
        category: 'sop',
      });

      expect(prisma.aiKnowledgeRule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            scope: 'branch',
            branchTag: 'CN2',
          }),
        }),
      );
    });

    it('creates a group-level rule with valid groupThreadId', async () => {
      vi.mocked(prisma.aiKnowledgeRule.create).mockResolvedValueOnce({ id: 'rule-group' } as any);

      await createKnowledgeRule(orgId, userId, {
        title: 'Bếp trưởng',
        ruleContent: 'Anh Nam là bếp trưởng duyệt món hủy',
        scope: 'group',
        groupThreadId: 'group-bep-1',
        category: 'personnel',
      });

      expect(prisma.aiKnowledgeRule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            scope: 'group',
            groupThreadId: 'group-bep-1',
          }),
        }),
      );
    });

    it('rejects empty title or title > 150 chars', async () => {
      await expect(
        createKnowledgeRule(orgId, userId, {
          title: '   ',
          ruleContent: 'Hợp lệ',
        }),
      ).rejects.toThrow('Tiêu đề quy tắc không được để trống');

      await expect(
        createKnowledgeRule(orgId, userId, {
          title: 'A'.repeat(151),
          ruleContent: 'Hợp lệ',
        }),
      ).rejects.toThrow('Tiêu đề quy tắc tối đa 150 ký tự');
    });

    it('rejects empty ruleContent or ruleContent > 2000 chars', async () => {
      await expect(
        createKnowledgeRule(orgId, userId, {
          title: 'Tiêu đề',
          ruleContent: '   ',
        }),
      ).rejects.toThrow('Nội dung quy tắc không được để trống');

      await expect(
        createKnowledgeRule(orgId, userId, {
          title: 'Tiêu đề',
          ruleContent: 'B'.repeat(2001),
        }),
      ).rejects.toThrow('Nội dung quy tắc tối đa 2000 ký tự');
    });

    it('rejects branch scope without branchTag', async () => {
      await expect(
        createKnowledgeRule(orgId, userId, {
          title: 'Quy tắc CN',
          ruleContent: 'Nội dung',
          scope: 'branch',
        }),
      ).rejects.toThrow('Vui lòng chỉ định nhãn chi nhánh cho quy tắc cấp chi nhánh');
    });

    it('rejects group scope without groupThreadId', async () => {
      await expect(
        createKnowledgeRule(orgId, userId, {
          title: 'Quy tắc Nhóm',
          ruleContent: 'Nội dung',
          scope: 'group',
        }),
      ).rejects.toThrow('Vui lòng chỉ định nhóm Zalo cho quy tắc cấp nhóm');
    });

    it('rejects invalid scope or category', async () => {
      await expect(
        createKnowledgeRule(orgId, userId, {
          title: 'Test',
          ruleContent: 'Test',
          scope: 'invalid_scope' as any,
        }),
      ).rejects.toThrow('Phạm vi quy tắc không hợp lệ');

      await expect(
        createKnowledgeRule(orgId, userId, {
          title: 'Test',
          ruleContent: 'Test',
          category: 'invalid_cat' as any,
        }),
      ).rejects.toThrow('Danh mục quy tắc không hợp lệ');
    });
  });

  describe('updateKnowledgeRule', () => {
    it('updates rule fields successfully when rule belongs to orgId', async () => {
      const existing = {
        id: 'rule-1',
        orgId,
        scope: 'org',
        title: 'Cũ',
        ruleContent: 'Nội dung cũ',
        category: 'general',
      };
      vi.mocked(prisma.aiKnowledgeRule.findFirst).mockResolvedValueOnce(existing as any);
      vi.mocked(prisma.aiKnowledgeRule.update).mockResolvedValueOnce({
        ...existing,
        title: 'Mới',
        isActive: false,
      } as any);

      const result = await updateKnowledgeRule(orgId, 'rule-1', {
        title: 'Mới',
        isActive: false,
      });

      expect(prisma.aiKnowledgeRule.update).toHaveBeenCalledWith({
        where: { id: 'rule-1' },
        data: expect.objectContaining({
          title: 'Mới',
          isActive: false,
        }),
      });
      expect(result.title).toBe('Mới');
    });

    it('enforces Tenant Isolation: throws 404 when updating rule from another org', async () => {
      vi.mocked(prisma.aiKnowledgeRule.findFirst).mockResolvedValueOnce(null);

      await expect(
        updateKnowledgeRule(otherOrgId, 'rule-1', { title: 'Hacked' }),
      ).rejects.toMatchObject({
        statusCode: 404,
        message: 'Không tìm thấy quy tắc tri thức',
      });
      expect(prisma.aiKnowledgeRule.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteKnowledgeRule', () => {
    it('deletes rule when it belongs to orgId', async () => {
      vi.mocked(prisma.aiKnowledgeRule.findFirst).mockResolvedValueOnce({ id: 'rule-1', orgId } as any);
      vi.mocked(prisma.aiKnowledgeRule.delete).mockResolvedValueOnce({ id: 'rule-1' } as any);

      const result = await deleteKnowledgeRule(orgId, 'rule-1');

      expect(prisma.aiKnowledgeRule.delete).toHaveBeenCalledWith({
        where: { id: 'rule-1' },
      });
      expect(result).toEqual({ success: true, id: 'rule-1' });
    });

    it('enforces Tenant Isolation: throws 404 when deleting rule from another org', async () => {
      vi.mocked(prisma.aiKnowledgeRule.findFirst).mockResolvedValueOnce(null);

      await expect(deleteKnowledgeRule(otherOrgId, 'rule-1')).rejects.toMatchObject({
        statusCode: 404,
        message: 'Không tìm thấy quy tắc tri thức',
      });
      expect(prisma.aiKnowledgeRule.delete).not.toHaveBeenCalled();
    });
  });

  describe('toggleKnowledgeRule', () => {
    it('toggles isActive state successfully', async () => {
      vi.mocked(prisma.aiKnowledgeRule.findFirst).mockResolvedValueOnce({ id: 'rule-1', orgId } as any);
      vi.mocked(prisma.aiKnowledgeRule.update).mockResolvedValueOnce({ id: 'rule-1', isActive: false } as any);

      const result = await toggleKnowledgeRule(orgId, 'rule-1', false);

      expect(prisma.aiKnowledgeRule.update).toHaveBeenCalledWith({
        where: { id: 'rule-1' },
        data: { isActive: false },
      });
      expect(result.isActive).toBe(false);
    });

    it('enforces Tenant Isolation: throws 404 when toggling rule of other org', async () => {
      vi.mocked(prisma.aiKnowledgeRule.findFirst).mockResolvedValueOnce(null);

      await expect(toggleKnowledgeRule(otherOrgId, 'rule-1', false)).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });

  describe('getDistinctBranchTags', () => {
    it('returns sorted unique non-empty branch tags for orgId', async () => {
      vi.mocked(prisma.zaloAccount.findMany).mockResolvedValueOnce([
        { branchTag: 'Quận 1' },
        { branchTag: 'Tân Bình' },
        { branchTag: 'Bình Thạnh' },
      ] as any);

      const branches = await getDistinctBranchTags(orgId);

      expect(prisma.zaloAccount.findMany).toHaveBeenCalledWith({
        where: {
          orgId,
          branchTag: { not: null },
        },
        select: { branchTag: true },
        distinct: ['branchTag'],
      });
      expect(branches).toEqual(['Bình Thạnh', 'Quận 1', 'Tân Bình']);
    });
  });
});
