/**
 * Tenant Isolation Assertions & Guards
 *
 * Enforces cross-organization isolation across foreign-key relationships.
 */

import type { Prisma, PrismaClient, Contact, User, Team } from '@prisma/client';
import { TenantIsolationError } from '../errors/index.js';

export async function assertContactInOrg(
  db: Prisma.TransactionClient | PrismaClient,
  orgId: string,
  contactId: string | null | undefined
): Promise<Contact | null> {
  if (!contactId) return null;
  const contact = await db.contact.findFirst({ where: { id: contactId, orgId } });
  if (!contact) throw new TenantIsolationError('Contact not found');
  return contact;
}

export async function assertUserInOrg(
  db: Prisma.TransactionClient | PrismaClient,
  orgId: string,
  userId: string | null | undefined,
  options?: { requireActive?: boolean }
): Promise<User | null> {
  if (!userId) return null;
  const requireActive = options?.requireActive ?? false;
  const user = await db.user.findFirst({
    where: { id: userId, orgId, ...(requireActive ? { isActive: true } : {}) },
  });
  if (!user) throw new TenantIsolationError('User not found');
  return user;
}

export async function assertTeamInOrg(
  db: Prisma.TransactionClient | PrismaClient,
  orgId: string,
  teamId: string | null | undefined
): Promise<Team | null> {
  if (!teamId) return null;
  const team = await db.team.findFirst({ where: { id: teamId, orgId } });
  if (!team) throw new TenantIsolationError('Team not found');
  return team;
}
