import type { FastifyRequest } from 'fastify';
import { authorizeReportTargets, decodeReportTargets } from '../report-target-service.js';

export type CurrentUser = NonNullable<FastifyRequest['user']>;
export type AccountPermission = 'read' | 'chat' | 'admin';

export const accountPermissionRank: Record<AccountPermission, number> = {
  read: 1,
  chat: 2,
  admin: 3,
};

export function isOrganizationAdministrator(user: CurrentUser): boolean {
  return user.role === 'owner' || user.role === 'admin';
}

export async function canAccessReport(
  user: CurrentUser,
  report: { orgId: string; sourceTargets: unknown; targetResolutionStatus: string },
  permission: AccountPermission = 'read'
): Promise<boolean> {
  if (report.orgId !== user.orgId) return false;
  if (report.targetResolutionStatus !== 'verified') return permission === 'read' && isOrganizationAdministrator(user);
  try {
    return await authorizeReportTargets(user.orgId, decodeReportTargets(report.sourceTargets), user, permission);
  } catch {
    return false;
  }
}
