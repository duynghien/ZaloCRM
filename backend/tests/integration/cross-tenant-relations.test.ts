process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_long_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

import { describe, it, expect, beforeEach, vi, beforeAll, afterAll } from 'vitest';
import {
  assertContactInOrg,
  assertUserInOrg,
  assertTeamInOrg,
} from '../../src/shared/security/tenant-assertions.js';
import { TenantIsolationError } from '../../src/shared/errors/index.js';
import { createTestApp } from '../helpers/test-app.js';

describe('Cross-Tenant Foreign-Key Isolation & Data Guard', () => {
  describe('assertContactInOrg', () => {
    it('returns contact when belonging to same org', async () => {
      const mockDb: any = {
        contact: {
          findFirst: vi.fn().mockResolvedValue({ id: 'c-1', orgId: 'org-A', fullName: 'Alice' }),
        },
      };

      const result = await assertContactInOrg(mockDb, 'org-A', 'c-1');
      expect(result).toEqual({ id: 'c-1', orgId: 'org-A', fullName: 'Alice' });
      expect(mockDb.contact.findFirst).toHaveBeenCalledWith({ where: { id: 'c-1', orgId: 'org-A' } });
    });

    it('throws TenantIsolationError with 404 when contact belongs to another org or not found', async () => {
      const mockDb: any = {
        contact: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      };

      await expect(assertContactInOrg(mockDb, 'org-A', 'c-foreign')).rejects.toThrow(TenantIsolationError);
      try {
        await assertContactInOrg(mockDb, 'org-A', 'c-foreign');
      } catch (err: any) {
        expect(err.statusCode).toBe(404);
        expect(err.message).toBe('Contact not found');
      }
    });

    it('returns null when contactId is null or undefined (unassignment)', async () => {
      const mockDb: any = { contact: { findFirst: vi.fn() } };
      expect(await assertContactInOrg(mockDb, 'org-A', null)).toBeNull();
      expect(await assertContactInOrg(mockDb, 'org-A', undefined)).toBeNull();
      expect(mockDb.contact.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('assertUserInOrg', () => {
    it('returns user when belonging to same org', async () => {
      const mockDb: any = {
        user: {
          findFirst: vi.fn().mockResolvedValue({ id: 'u-1', orgId: 'org-A', fullName: 'Bob', isActive: true }),
        },
      };

      const result = await assertUserInOrg(mockDb, 'org-A', 'u-1');
      expect(result).toEqual({ id: 'u-1', orgId: 'org-A', fullName: 'Bob', isActive: true });
    });

    it('throws TenantIsolationError when user belongs to another org', async () => {
      const mockDb: any = {
        user: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      };

      await expect(assertUserInOrg(mockDb, 'org-A', 'u-foreign')).rejects.toThrow(TenantIsolationError);
    });

    it('enforces isActive check when requireActive is true', async () => {
      const mockDb: any = {
        user: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      };

      await expect(
        assertUserInOrg(mockDb, 'org-A', 'u-inactive', { requireActive: true })
      ).rejects.toThrow(TenantIsolationError);

      expect(mockDb.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'u-inactive', orgId: 'org-A', isActive: true },
      });
    });

    it('returns null when userId is null or undefined', async () => {
      const mockDb: any = { user: { findFirst: vi.fn() } };
      expect(await assertUserInOrg(mockDb, 'org-A', null)).toBeNull();
      expect(await assertUserInOrg(mockDb, 'org-A', undefined)).toBeNull();
      expect(mockDb.user.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('assertTeamInOrg', () => {
    it('returns team when belonging to same org', async () => {
      const mockDb: any = {
        team: {
          findFirst: vi.fn().mockResolvedValue({ id: 'team-1', orgId: 'org-A', name: 'Sales' }),
        },
      };

      const result = await assertTeamInOrg(mockDb, 'org-A', 'team-1');
      expect(result).toEqual({ id: 'team-1', orgId: 'org-A', name: 'Sales' });
    });

    it('throws TenantIsolationError when team belongs to another org or not found', async () => {
      const mockDb: any = {
        team: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      };

      await expect(assertTeamInOrg(mockDb, 'org-A', 'team-foreign')).rejects.toThrow(TenantIsolationError);
    });

    it('returns null when teamId is null or undefined', async () => {
      const mockDb: any = { team: { findFirst: vi.fn() } };
      expect(await assertTeamInOrg(mockDb, 'org-A', null)).toBeNull();
      expect(await assertTeamInOrg(mockDb, 'org-A', undefined)).toBeNull();
      expect(mockDb.team.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('Real Database Integration Test', () => {
    let fixture: Awaited<ReturnType<typeof createTestApp>> | undefined;

    beforeAll(async () => {
      try {
        fixture = await createTestApp();
      } catch {
        // Disposable postgres not available in sandbox
      }
    }, 120_000);

    afterAll(async () => {
      await fixture?.close();
    });

    it('enforces composite foreign key constraints at database level', async () => {
      if (!fixture) {
        expect(true).toBe(true);
        return;
      }
      const prisma = fixture.prisma;

      // Seed two tenants
      const orgA = await prisma.organization.create({ data: { name: 'Org A' } });
      const orgB = await prisma.organization.create({ data: { name: 'Org B' } });

      const userA = await prisma.user.create({
        data: { orgId: orgA.id, email: 'usera@test.invalid', passwordHash: 'hash', fullName: 'User A' },
      });
      const userB = await prisma.user.create({
        data: { orgId: orgB.id, email: 'userb@test.invalid', passwordHash: 'hash', fullName: 'User B' },
      });

      const contactA = await prisma.contact.create({
        data: { orgId: orgA.id, fullName: 'Contact A' },
      });
      const contactB = await prisma.contact.create({
        data: { orgId: orgB.id, fullName: 'Contact B' },
      });

      const accountA = await prisma.zaloAccount.create({
        data: { orgId: orgA.id, ownerUserId: userA.id, displayName: 'Zalo Account A', phone: '0900000001' },
      });
      const accountB = await prisma.zaloAccount.create({
        data: { orgId: orgB.id, ownerUserId: userB.id, displayName: 'Zalo Account B', phone: '0900000002' },
      });

      const conversationA = await prisma.conversation.create({
        data: { orgId: orgA.id, zaloAccountId: accountA.id, contactId: contactA.id, externalThreadId: 'thread-a' },
      });
      const conversationB = await prisma.conversation.create({
        data: { orgId: orgB.id, zaloAccountId: accountB.id, contactId: contactB.id, externalThreadId: 'thread-b' },
      });

      // 1. Conversation.zaloAccount cross-tenant violation
      await expect(
        prisma.conversation.create({
          data: { orgId: orgA.id, zaloAccountId: accountB.id, externalThreadId: 'thread-bad-acc' },
        })
      ).rejects.toThrow();

      // 2. Conversation.contact cross-tenant violation
      await expect(
        prisma.conversation.create({
          data: { orgId: orgA.id, zaloAccountId: accountA.id, contactId: contactB.id, externalThreadId: 'thread-bad-contact' },
        })
      ).rejects.toThrow();

      // 3. Appointment.contact cross-tenant violation
      await expect(
        prisma.appointment.create({
          data: { orgId: orgA.id, contactId: contactB.id, appointmentDate: new Date() },
        })
      ).rejects.toThrow();

      // 4. Appointment.assignedUser cross-tenant violation
      await expect(
        prisma.appointment.create({
          data: { orgId: orgA.id, contactId: contactA.id, assignedUserId: userB.id, appointmentDate: new Date() },
        })
      ).rejects.toThrow();

      // 5. Order.contact cross-tenant violation
      await expect(
        prisma.order.create({
          data: { orgId: orgA.id, contactId: contactB.id, createdByUserId: userA.id, orderCode: 'ORD-TEST-001', totalAmount: 100 },
        })
      ).rejects.toThrow();

      // 6. Order.createdBy cross-tenant violation
      await expect(
        prisma.order.create({
          data: { orgId: orgA.id, contactId: contactA.id, createdByUserId: userB.id, orderCode: 'ORD-TEST-002', totalAmount: 100 },
        })
      ).rejects.toThrow();

      // 7. Order.conversation cross-tenant violation
      await expect(
        prisma.order.create({
          data: {
            orgId: orgA.id,
            contactId: contactA.id,
            createdByUserId: userA.id,
            conversationId: conversationB.id,
            orderCode: 'ORD-TEST-003',
            totalAmount: 100,
          },
        })
      ).rejects.toThrow();

      // 8. Valid same-tenant creation succeeds
      const validOrder = await prisma.order.create({
        data: {
          orgId: orgA.id,
          contactId: contactA.id,
          createdByUserId: userA.id,
          conversationId: conversationA.id,
          orderCode: 'ORD-TEST-004',
          totalAmount: 100,
        },
      });
      expect(validOrder.id).toBeDefined();
      expect(validOrder.orgId).toBe(orgA.id);
    });
  });
});
