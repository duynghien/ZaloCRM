import { prisma } from '../../../shared/database/prisma-client.js';

export type KnowledgeScope = 'org' | 'branch' | 'group';
export type KnowledgeCategory = 'personnel' | 'sop' | 'terminology' | 'correction' | 'general';

export const VALID_SCOPES: readonly KnowledgeScope[] = ['org', 'branch', 'group'];
export const VALID_CATEGORIES: readonly KnowledgeCategory[] = [
  'personnel',
  'sop',
  'terminology',
  'correction',
  'general',
];

export class KnowledgeValidationError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'KnowledgeValidationError';
    this.statusCode = statusCode;
  }
}

export interface ListKnowledgeRulesFilter {
  scope?: KnowledgeScope;
  branchTag?: string;
  groupThreadId?: string;
  category?: KnowledgeCategory;
  isActive?: boolean;
  search?: string;
}

export interface CreateKnowledgeRuleInput {
  scope?: KnowledgeScope;
  branchTag?: string | null;
  groupThreadId?: string | null;
  zaloAccountId?: string | null;
  category?: KnowledgeCategory;
  title: string;
  ruleContent?: string;
  content?: string;
  isActive?: boolean;
  sourceReportId?: string | null;
}

export interface UpdateKnowledgeRuleInput {
  scope?: KnowledgeScope;
  branchTag?: string | null;
  groupThreadId?: string | null;
  zaloAccountId?: string | null;
  category?: KnowledgeCategory;
  title?: string;
  ruleContent?: string;
  content?: string;
  isActive?: boolean;
}

export function formatRuleResponse<T extends Record<string, any>>(rule: T): T & { content: string; ruleContent: string } {
  if (!rule) return rule;
  const content = rule.ruleContent ?? rule.content ?? '';
  return {
    ...rule,
    content,
    ruleContent: content,
  };
}

function sanitizeText(text: string): string {
  // Strip dangerous control characters while preserving standard whitespace and newlines
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

function validateRuleFields(
  title?: string,
  ruleContent?: string,
  scope?: KnowledgeScope,
  category?: KnowledgeCategory,
  branchTag?: string | null,
  groupThreadId?: string | null,
): { cleanTitle?: string; cleanContent?: string } {
  let cleanTitle: string | undefined;
  let cleanContent: string | undefined;

  if (title !== undefined) {
    cleanTitle = sanitizeText(title);
    if (!cleanTitle) {
      throw new KnowledgeValidationError('Tiêu đề quy tắc không được để trống');
    }
    if (cleanTitle.length > 150) {
      throw new KnowledgeValidationError('Tiêu đề quy tắc tối đa 150 ký tự');
    }
  }

  if (ruleContent !== undefined) {
    cleanContent = sanitizeText(ruleContent);
    if (!cleanContent) {
      throw new KnowledgeValidationError('Nội dung quy tắc không được để trống');
    }
    if (cleanContent.length > 2000) {
      throw new KnowledgeValidationError('Nội dung quy tắc tối đa 2000 ký tự');
    }
  }

  if (scope !== undefined && !VALID_SCOPES.includes(scope)) {
    throw new KnowledgeValidationError(`Phạm vi quy tắc không hợp lệ: ${scope}`);
  }

  if (category !== undefined && !VALID_CATEGORIES.includes(category)) {
    throw new KnowledgeValidationError(`Danh mục quy tắc không hợp lệ: ${category}`);
  }

  if (scope === 'branch' && !branchTag?.trim()) {
    throw new KnowledgeValidationError('Vui lòng chỉ định nhãn chi nhánh cho quy tắc cấp chi nhánh');
  }

  if (scope === 'group' && !groupThreadId?.trim()) {
    throw new KnowledgeValidationError('Vui lòng chỉ định nhóm Zalo cho quy tắc cấp nhóm');
  }

  return { cleanTitle, cleanContent };
}

export async function listKnowledgeRules(orgId: string, filter?: ListKnowledgeRulesFilter) {
  const where: any = { orgId };

  if (filter?.scope && VALID_SCOPES.includes(filter.scope)) {
    where.scope = filter.scope;
  }
  if (filter?.branchTag) {
    where.branchTag = filter.branchTag.trim();
  }
  if (filter?.groupThreadId) {
    where.groupThreadId = filter.groupThreadId.trim();
  }
  if (filter?.category && VALID_CATEGORIES.includes(filter.category)) {
    where.category = filter.category;
  }
  if (typeof filter?.isActive === 'boolean') {
    where.isActive = filter.isActive;
  }
  if (filter?.search?.trim()) {
    const term = filter.search.trim();
    where.OR = [
      { title: { contains: term, mode: 'insensitive' } },
      { ruleContent: { contains: term, mode: 'insensitive' } },
    ];
  }

  const rules = await prisma.aiKnowledgeRule.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });
  return rules.map(formatRuleResponse);
}

export async function createKnowledgeRule(
  orgId: string,
  userId: string | null,
  data: CreateKnowledgeRuleInput,
) {
  const scope = data.scope || 'org';
  const category = data.category || 'general';
  const rawContent = data.ruleContent !== undefined ? data.ruleContent : data.content;
  const { cleanTitle, cleanContent } = validateRuleFields(
    data.title,
    rawContent,
    scope,
    category,
    data.branchTag,
    data.groupThreadId,
  );

  const rule = await prisma.aiKnowledgeRule.create({
    data: {
      orgId,
      createdById: userId,
      scope,
      branchTag: scope === 'branch' ? data.branchTag?.trim() || null : null,
      groupThreadId: scope === 'group' ? data.groupThreadId?.trim() || null : null,
      zaloAccountId: data.zaloAccountId?.trim() || null,
      category,
      title: cleanTitle!,
      ruleContent: cleanContent!,
      isActive: data.isActive !== undefined ? data.isActive : true,
      sourceReportId: data.sourceReportId?.trim() || null,
    },
  });
  return formatRuleResponse(rule);
}

export async function updateKnowledgeRule(
  orgId: string,
  ruleId: string,
  data: UpdateKnowledgeRuleInput,
) {
  const existing = await prisma.aiKnowledgeRule.findFirst({
    where: { id: ruleId, orgId },
  });
  if (!existing) {
    throw new KnowledgeValidationError('Không tìm thấy quy tắc tri thức', 404);
  }

  const scope = data.scope ?? (existing.scope as KnowledgeScope);
  const category = data.category ?? (existing.category as KnowledgeCategory);
  const branchTag = data.branchTag !== undefined ? data.branchTag : existing.branchTag;
  const groupThreadId = data.groupThreadId !== undefined ? data.groupThreadId : existing.groupThreadId;
  const rawContent = data.ruleContent !== undefined ? data.ruleContent : data.content;

  const { cleanTitle, cleanContent } = validateRuleFields(
    data.title,
    rawContent,
    data.scope,
    data.category,
    branchTag,
    groupThreadId,
  );

  const updateData: any = {};
  if (cleanTitle !== undefined) updateData.title = cleanTitle;
  if (cleanContent !== undefined) updateData.ruleContent = cleanContent;
  if (data.scope !== undefined) {
    updateData.scope = scope;
    updateData.branchTag = scope === 'branch' ? branchTag?.trim() || null : null;
    updateData.groupThreadId = scope === 'group' ? groupThreadId?.trim() || null : null;
  } else {
    if (data.branchTag !== undefined) updateData.branchTag = data.branchTag?.trim() || null;
    if (data.groupThreadId !== undefined) updateData.groupThreadId = data.groupThreadId?.trim() || null;
  }
  if (data.zaloAccountId !== undefined) updateData.zaloAccountId = data.zaloAccountId?.trim() || null;
  if (data.category !== undefined) updateData.category = category;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;

  const updated = await prisma.aiKnowledgeRule.update({
    where: { id: ruleId },
    data: updateData,
  });
  return formatRuleResponse(updated);
}

export async function deleteKnowledgeRule(orgId: string, ruleId: string) {
  const existing = await prisma.aiKnowledgeRule.findFirst({
    where: { id: ruleId, orgId },
  });
  if (!existing) {
    throw new KnowledgeValidationError('Không tìm thấy quy tắc tri thức', 404);
  }

  await prisma.aiKnowledgeRule.delete({
    where: { id: ruleId },
  });

  return { success: true, id: ruleId };
}

export async function toggleKnowledgeRule(orgId: string, ruleId: string, isActive: boolean) {
  const existing = await prisma.aiKnowledgeRule.findFirst({
    where: { id: ruleId, orgId },
  });
  if (!existing) {
    throw new KnowledgeValidationError('Không tìm thấy quy tắc tri thức', 404);
  }

  const updated = await prisma.aiKnowledgeRule.update({
    where: { id: ruleId },
    data: { isActive },
  });
  return formatRuleResponse(updated);
}

export async function getDistinctBranchTags(orgId: string): Promise<string[]> {
  const accounts = await prisma.zaloAccount.findMany({
    where: {
      orgId,
      branchTag: { not: null },
    },
    select: { branchTag: true },
    distinct: ['branchTag'],
  });

  return accounts
    .map(a => a.branchTag?.trim())
    .filter((t): t is string => Boolean(t))
    .sort();
}
