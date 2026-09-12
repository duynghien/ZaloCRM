import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/test-app.js';

let fixture: Awaited<ReturnType<typeof createTestApp>>;
let service: typeof import('../../src/modules/ai-reports/report-target-service.js');
beforeAll(async () => {
  fixture = await createTestApp();
  service = await import('../../src/modules/ai-reports/report-target-service.js');
}, 120_000);
afterAll(async () => { await fixture?.close(); });

async function seed() {
  const db = fixture.prisma;
  const org = await db.organization.create({ data: { name: 'Target tests' } });
  const foreignOrg = await db.organization.create({ data: { name: 'Foreign targets' } });
  const person = (orgId: string, role: string) => db.user.create({ data: { orgId, role, email: `${randomUUID()}@test.invalid`, fullName: role, passwordHash: 'unused' } });
  const owner = await person(org.id, 'owner');
  const member = await person(org.id, 'member');
  const foreignOwner = await person(foreignOrg.id, 'owner');
  const account = (orgId: string, ownerUserId: string) => db.zaloAccount.create({ data: { orgId, ownerUserId } });
  const a = await account(org.id, owner.id);
  const b = await account(org.id, owner.id);
  const foreign = await account(foreignOrg.id, foreignOwner.id);
  const conversation = (zaloAccountId: string, thread: string, orgId = org.id, threadType = 'group') => db.conversation.create({ data: { orgId, zaloAccountId, externalThreadId: thread, threadType } });
  // Reverse insertion ensures account order can never become source authority.
  const sharedB = await conversation(b.id, 'shared');
  const sharedA = await conversation(a.id, 'shared');
  const a1 = await conversation(a.id, 'g1'); const b2 = await conversation(b.id, 'g2');
  const a2 = await conversation(a.id, 'g2'); const b1 = await conversation(b.id, 'g1');
  const unique = await conversation(a.id, 'unique');
  const userThread = await conversation(a.id, 'direct', org.id, 'user');
  const foreignGroup = await conversation(foreign.id, 'unique', foreignOrg.id);
  const inconsistentOrg = await conversation(foreign.id, 'bad-org', org.id);
  const grant = await db.zaloAccountAccess.create({ data: { zaloAccountId: a.id, userId: member.id, permission: 'read' } });
  const target = (c: typeof a1) => ({ zaloAccountId: c.zaloAccountId, groupThreadId: c.externalThreadId!, conversationId: c.id });
  return { org, owner, member, foreignOwner, a, b, foreign, sharedA, sharedB, a1, b2, a2, b1, unique, userThread, foreignGroup, inconsistentOrg, grant, target };
}

describe('account-qualified report targets against disposable PostgreSQL', () => {
  it('freezes exact pairs and excludes shared-thread and cross-pair decoys', async () => {
    const s = await seed();
    const resolve = (pairs: { zaloAccountId: string; groupThreadId: string }[]) => service.resolveReportTargets(s.org.id, { groupTargets: pairs }, s.owner, 'read');
    expect(await resolve([{ zaloAccountId: s.a.id, groupThreadId: 'shared' }])).toEqual([s.target(s.sharedA)]);
    expect(await resolve([{ zaloAccountId: s.b.id, groupThreadId: 'shared' }])).toEqual([s.target(s.sharedB)]);
    const pairs = [{ zaloAccountId: s.a.id, groupThreadId: 'g1' }, { zaloAccountId: s.b.id, groupThreadId: 'g2' }];
    const targets = await resolve(pairs);
    expect(targets).toEqual(await resolve([...pairs].reverse()));
    expect(new Set(targets.map(t => t.conversationId))).toEqual(new Set([s.a1.id, s.b2.id]));
    expect(await service.authorizeReportTargets(s.org.id, [{ ...s.target(s.a1), conversationId: s.a2.id }, s.target(s.b2)], s.owner, 'read')).toBe(false);
  });

  it('rejects legacy ambiguity before ACL but resolves a unique group in the whole org', async () => {
    const s = await seed();
    await expect(service.resolveReportTargets(s.org.id, { groupThreadIds: ['shared'] }, s.member, 'read')).rejects.toMatchObject({ statusCode: 409, message: 'ambiguous_group_target' });
    expect(await service.resolveReportTargets(s.org.id, { groupThreadIds: ['unique'] }, s.member, 'read')).toEqual([s.target(s.unique)]);
  });

  it('enforces every current read/chat/admin grant, source org, actor and sender', async () => {
    const s = await seed();
    for (const permission of ['read', 'chat', 'admin'] as const) {
      await fixture.prisma.zaloAccountAccess.update({ where: { id: s.grant.id }, data: { permission } });
      for (const required of ['read', 'chat', 'admin'] as const) {
        const expected = ['read', 'chat', 'admin'].indexOf(permission) >= ['read', 'chat', 'admin'].indexOf(required);
        expect(await service.authorizeReportTargets(s.org.id, [s.target(s.sharedA)], s.member, required)).toBe(expected);
        expect(await service.authorizeReportAccount(s.org.id, s.a.id, s.member, required)).toBe(expected);
      }
    }
    expect(await service.authorizeReportTargets(s.org.id, [s.target(s.sharedA), s.target(s.sharedB)], s.member, 'read')).toBe(false);
    for (const source of [s.foreignGroup, s.inconsistentOrg, s.userThread]) {
      expect(await service.authorizeReportTargets(s.org.id, [s.target(source)], s.owner, 'read')).toBe(false);
      expect(await service.authorizeReportTargets(s.org.id, [s.target(source)], null, 'read')).toBe(false);
    }
    expect(await service.authorizeReportAccount(s.org.id, s.foreign.id, s.owner, 'admin')).toBe(false);
    expect(await service.authorizeReportAccount(s.org.id, s.a.id, s.foreignOwner, 'read')).toBe(false);
    expect(await service.authorizeReportTargets(s.org.id, [s.target(s.sharedA)], null, 'chat')).toBe(true);
    await fixture.prisma.user.update({ where: { id: s.owner.id }, data: { role: 'member' } });
    expect(await service.authorizeReportTargets(s.org.id, [s.target(s.sharedA)], s.owner, 'read')).toBe(false);
    await fixture.prisma.user.update({ where: { id: s.member.id }, data: { isActive: false } });
    expect(await service.authorizeReportAccount(s.org.id, s.a.id, s.member, 'read')).toBe(false);
  });

  it('fails closed after grant revocation or replacement of the frozen conversation', async () => {
    const s = await seed(); const frozen = [s.target(s.unique)];
    await fixture.prisma.zaloAccountAccess.delete({ where: { id: s.grant.id } });
    await expect(service.resolveReportTargets(s.org.id, { groupThreadIds: ['unique'] }, s.member, 'read')).rejects.toMatchObject({ statusCode: 404 });
    expect(await service.authorizeReportTargets(s.org.id, frozen, s.member, 'read')).toBe(false);
    await fixture.prisma.conversation.delete({ where: { id: s.unique.id } });
    await fixture.prisma.conversation.create({ data: { orgId: s.org.id, zaloAccountId: s.a.id, externalThreadId: 'unique', threadType: 'group' } });
    expect(await service.authorizeReportTargets(s.org.id, frozen, s.owner, 'read')).toBe(false);
    expect(await service.authorizeReportTargets(s.org.id, frozen, null, 'read')).toBe(false);
  });

  it('rejects malformed, empty, oversized, duplicate and mixed selectors and provenance', async () => {
    const s = await seed(); const target = s.target(s.unique);
    const badTargets: unknown[] = [null, [], [target, target], [{ ...target, conversationId: '' }], [{ ...target, extra: true }], [target, { ...target, groupThreadId: 'different' }], Array.from({ length: 21 }, (_, i) => ({ zaloAccountId: `a${i}`, groupThreadId: 'g', conversationId: `c${i}` }))];
    for (const value of badTargets) expect(() => service.decodeReportTargets(value)).toThrow(service.ReportTargetError);
    const invalidSelectors = [{}, { groupTargets: [] }, { groupTargets: [target] }, { groupThreadIds: ['unique', 'unique'] }, { groupThreadIds: [' '] }, { groupTargets: [], groupThreadIds: ['unique'] }, { groupThreadIds: Array.from({ length: 21 }, (_, i) => `${i}`) }];
    for (const selectors of invalidSelectors) await expect(service.resolveReportTargets(s.org.id, selectors as never, s.owner, 'read')).rejects.toMatchObject({ statusCode: 400 });
    for (const thread of ['direct', 'missing', 'bad-org']) await expect(service.resolveReportTargets(s.org.id, { groupThreadIds: [thread] }, s.owner, 'read')).rejects.toMatchObject({ statusCode: 404 });
  });
});
