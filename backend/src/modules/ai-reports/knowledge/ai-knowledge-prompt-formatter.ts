import { prisma } from '../../../shared/database/prisma-client.js';

export interface PromptFormattingOptions {
  maxRules?: number;
  maxTokens?: number;
}

export function sanitizeRuleContentForPrompt(text: string): string {
  if (!text) return '';
  return text
    .replace(/<\/verified_operational_knowledge>/gi, '[closed_rule_tag]')
    .replace(/<verified_operational_knowledge>/gi, '[open_rule_tag]')
    .replace(/<!\[CDATA\[/gi, '[cdata_start]')
    .replace(/\]\]>/gi, '[cdata_end]')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();
}

export function estimateTokenCount(text: string): number {
  if (!text || !text.trim()) return 0;
  const words = text.trim().split(/\s+/).length;
  return Math.ceil(words * 1.3);
}

export async function fetchHierarchicalKnowledge(
  orgId: string,
  branchTag?: string | null,
  groupThreadId?: string | null,
) {
  const conditions: any[] = [{ scope: 'org' }];
  if (branchTag?.trim()) {
    conditions.push({ scope: 'branch', branchTag: branchTag.trim() });
  }
  if (groupThreadId?.trim()) {
    conditions.push({ scope: 'group', groupThreadId: groupThreadId.trim() });
  }

  return prisma.aiKnowledgeRule.findMany({
    where: {
      orgId,
      isActive: true,
      OR: conditions,
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function fetchMultiBranchKnowledge(
  orgId: string,
  branchTags: string[],
) {
  const cleanBranchTags = branchTags.map(b => b.trim()).filter(Boolean);
  const conditions: any[] = [{ scope: 'org' }];
  if (cleanBranchTags.length > 0) {
    conditions.push({ scope: 'branch', branchTag: { in: cleanBranchTags } });
  }

  return prisma.aiKnowledgeRule.findMany({
    where: {
      orgId,
      isActive: true,
      OR: conditions,
    },
    orderBy: { createdAt: 'desc' },
  });
}

function getScopePriority(scope: string): number {
  switch (scope) {
    case 'group':
      return 3;
    case 'branch':
      return 2;
    case 'org':
    default:
      return 1;
  }
}

function getCategoryLabel(category: string): string {
  switch (category) {
    case 'personnel':
      return 'Nhân sự';
    case 'sop':
      return 'Quy trình SOP';
    case 'terminology':
      return 'Thuật ngữ';
    case 'correction':
      return 'Đính chính';
    case 'general':
    default:
      return 'Chung';
  }
}

function buildXmlBlock(rules: any[]): string {
  if (rules.length === 0) return '';

  const orgRules = rules.filter(r => r.scope === 'org');
  const branchRules = rules.filter(r => r.scope === 'branch');
  const groupRules = rules.filter(r => r.scope === 'group');

  const sections: string[] = [];

  if (orgRules.length > 0) {
    const lines = ['[QUY CHUẨN THƯƠNG HIỆU / TOÀN HỆ THỐNG]'];
    for (const r of orgRules) {
      const cat = getCategoryLabel(r.category);
      const title = sanitizeRuleContentForPrompt(r.title);
      const content = sanitizeRuleContentForPrompt(r.ruleContent);
      lines.push(`- (${cat}) ${title}: ${content}`);
    }
    sections.push(lines.join('\n'));
  }

  if (branchRules.length > 0) {
    const branchMap = new Map<string, any[]>();
    for (const r of branchRules) {
      const tag = r.branchTag || 'Chi nhánh';
      if (!branchMap.has(tag)) branchMap.set(tag, []);
      branchMap.get(tag)!.push(r);
    }

    for (const [tag, bRules] of branchMap.entries()) {
      const lines = [`[QUY ĐỊNH CHI NHÁNH: ${tag}]`];
      for (const r of bRules) {
        const cat = getCategoryLabel(r.category);
        const title = sanitizeRuleContentForPrompt(r.title);
        const content = sanitizeRuleContentForPrompt(r.ruleContent);
        lines.push(`- (${cat}) ${title}: ${content}`);
      }
      sections.push(lines.join('\n'));
    }
  }

  if (groupRules.length > 0) {
    const groupMap = new Map<string, any[]>();
    for (const r of groupRules) {
      const gId = r.groupThreadId || 'Nhóm';
      if (!groupMap.has(gId)) groupMap.set(gId, []);
      groupMap.get(gId)!.push(r);
    }

    for (const [gId, gRules] of groupMap.entries()) {
      const lines = [`[QUY TẮC NHÓM & NHÂN SỰ ĐÃ HỌC ĐƯỢC: ${gId}]`];
      for (const r of gRules) {
        const cat = getCategoryLabel(r.category);
        const title = sanitizeRuleContentForPrompt(r.title);
        const content = sanitizeRuleContentForPrompt(r.ruleContent);
        lines.push(`- (${cat}) ${title}: ${content}`);
      }
      sections.push(lines.join('\n'));
    }
  }

  if (sections.length === 0) return '';

  return `<verified_operational_knowledge>\n${sections.join('\n\n')}\n</verified_operational_knowledge>`;
}

export function formatKnowledgeForPrompt(
  rules: any[],
  options?: PromptFormattingOptions,
): string {
  if (!rules || rules.length === 0) return '';

  const activeRules = rules.filter(r => r.isActive !== false);
  if (activeRules.length === 0) return '';

  // Sort by priority: group > branch > org; then by createdAt desc (newest first)
  const sorted = [...activeRules].sort((a, b) => {
    const pDiff = getScopePriority(b.scope) - getScopePriority(a.scope);
    if (pDiff !== 0) return pDiff;
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });

  const maxRules = options?.maxRules ?? 15;
  const maxTokens = options?.maxTokens ?? 600;

  let candidateRules = sorted.slice(0, maxRules);

  let xml = buildXmlBlock(candidateRules);
  while (candidateRules.length > 0 && estimateTokenCount(xml) > maxTokens) {
    // Drop the lowest priority rule (last in sorted list)
    candidateRules.pop();
    xml = buildXmlBlock(candidateRules);
  }

  return xml;
}
