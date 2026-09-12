import { prisma } from '../../shared/database/prisma-client.js';
import { hasZaloAccess, type Permission } from '../zalo/zalo-access-middleware.js';

export type ReportTarget = { zaloAccountId: string; groupThreadId: string; conversationId: string };
type ReportUser = { id: string; orgId: string; role: string };
type Selectors = { groupTargets?: { zaloAccountId: string; groupThreadId: string }[]; groupThreadIds?: string[] };

export class ReportTargetError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message); this.name = 'ReportTargetError'; }
}

const invalid = () => new ReportTargetError(400, 'invalid_report_targets');
const inaccessible = () => new ReportTargetError(404, 'group_target_not_found');
const isId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value === value.trim();
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const pairKey = (target: { zaloAccountId: string; groupThreadId: string }) => JSON.stringify([target.zaloAccountId, target.groupThreadId]);
const sortTargets = (targets: ReportTarget[]) => targets.sort((a, b) => pairKey(a) < pairKey(b) ? -1 : pairKey(a) > pairKey(b) ? 1 : 0);

/** Decode persisted provenance without reconstructing identities from current data. */
export function decodeReportTargets(value: unknown): ReportTarget[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) throw invalid();
  const pairs = new Set<string>();
  const conversations = new Set<string>();
  const targets = value.map(item => {
    if (!isRecord(item) || Object.keys(item).sort().join(',') !== 'conversationId,groupThreadId,zaloAccountId'
      || !isId(item.zaloAccountId) || !isId(item.groupThreadId) || !isId(item.conversationId)) throw invalid();
    const target = { zaloAccountId: item.zaloAccountId, groupThreadId: item.groupThreadId, conversationId: item.conversationId };
    if (pairs.has(pairKey(target)) || conversations.has(target.conversationId)) throw invalid();
    pairs.add(pairKey(target)); conversations.add(target.conversationId);
    return target;
  });
  return sortTargets(targets);
}

async function currentUser(orgId: string, user: ReportUser): Promise<ReportUser | null> {
  if (user.orgId !== orgId) return null;
  return prisma.user.findFirst({ where: { id: user.id, orgId, isActive: true }, select: { id: true, orgId: true, role: true } });
}

/** Null is reserved for a caller-proven scheduled job, never a missing creator. */
export async function authorizeReportAccount(orgId: string, accountId: string, user: ReportUser | null, permission: Permission): Promise<boolean> {
  if (!isId(orgId) || !isId(accountId)) return false;
  if (user === null) return !!await prisma.zaloAccount.findFirst({ where: { id: accountId, orgId }, select: { id: true } });
  const actor = await currentUser(orgId, user);
  return !!actor && hasZaloAccess(actor, accountId, permission);
}

/** Match each exact frozen triple; separate IN lists would admit cross-pair decoys. */
export async function authorizeReportTargets(orgId: string, targets: ReportTarget[], user: ReportUser | null, permission: Permission): Promise<boolean> {
  let decoded: ReportTarget[];
  try { decoded = decodeReportTargets(targets); } catch (error) { if (error instanceof ReportTargetError) return false; throw error; }
  const matches = await prisma.conversation.count({ where: {
    orgId, threadType: 'group', zaloAccount: { orgId },
    OR: decoded.map(target => ({ id: target.conversationId, zaloAccountId: target.zaloAccountId, externalThreadId: target.groupThreadId })),
  } });
  if (matches !== decoded.length) return false;
  for (const accountId of new Set(decoded.map(target => target.zaloAccountId))) {
    if (!await authorizeReportAccount(orgId, accountId, user, permission)) return false;
  }
  return true;
}

export async function resolveReportTargets(orgId: string, selectors: Selectors, user: ReportUser | null, permission: Permission): Promise<ReportTarget[]> {
  if (!isRecord(selectors) || Object.keys(selectors).some(key => !['groupTargets', 'groupThreadIds'].includes(key))) throw invalid();
  const explicit = selectors.groupTargets !== undefined;
  if (explicit === (selectors.groupThreadIds !== undefined)) throw invalid();
  const values = explicit ? selectors.groupTargets : selectors.groupThreadIds;
  if (!Array.isArray(values) || !values.length || values.length > 20) throw invalid();
  const keys = new Set<string>();
  for (const value of values) {
    if (explicit) {
      if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'groupThreadId,zaloAccountId'
        || !isId(value.zaloAccountId) || !isId(value.groupThreadId)) throw invalid();
    } else if (!isId(value)) throw invalid();
    const key = explicit ? pairKey(value as { zaloAccountId: string; groupThreadId: string }) : value as string;
    if (keys.has(key)) throw invalid();
    keys.add(key);
  }
  const targets: ReportTarget[] = [];
  for (const value of values) {
    const pair = explicit ? value as { zaloAccountId: string; groupThreadId: string } : null;
    const groupThreadId = pair ? pair.groupThreadId : value as string;
    // Resolve legacy ambiguity across the entire organization before considering ACL.
    const candidates = await prisma.conversation.findMany({ where: {
      orgId, threadType: 'group', externalThreadId: groupThreadId, zaloAccount: { orgId },
      ...(pair ? { zaloAccountId: pair.zaloAccountId } : {}),
    }, select: { id: true, zaloAccountId: true }, take: 2 });
    if (candidates.length > 1) throw new ReportTargetError(409, 'ambiguous_group_target');
    if (!candidates.length) throw inaccessible();
    targets.push({ zaloAccountId: candidates[0].zaloAccountId, groupThreadId, conversationId: candidates[0].id });
  }
  if (!await authorizeReportTargets(orgId, targets, user, permission)) throw inaccessible();
  return sortTargets(targets);
}
