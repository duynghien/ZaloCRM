import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../helpers/test-app.js';
import { sessionCache } from '../../src/modules/auth/auth-service.js';

let fixture: Awaited<ReturnType<typeof createTestApp>>;
const password = 'FixturePassword123';
let passwordHash: string;
beforeAll(async () => { fixture = await createTestApp(); passwordHash = await bcrypt.hash(password, 4); }, 120_000);
afterAll(async () => { await fixture?.close(); });

async function seed(role = 'owner', orgId?: string) {
  orgId ??= (await fixture.prisma.organization.create({ data: { name: 'Auth settings fixture' } })).id;
  return fixture.prisma.user.create({ data: { orgId, role, email: `${randomUUID()}@test.invalid`, fullName: role, passwordHash } });
}
async function login(user: Awaited<ReturnType<typeof seed>>) {
  const response = await fixture.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.email, password } });
  expect(response.statusCode).toBe(200);
  return { response, token: response.json().token as string, cookies: Object.fromEntries(response.cookies.map(c => [c.name, c.value])) };
}
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const refreshHeaders = (cookies: Record<string, string>) => ({ origin: 'http://127.0.0.1:3000', 'x-csrf-token': cookies.zalo_crm_csrf });

// Exercise production auth and persistence; no auth, Prisma or policy doubles.
describe('auth and settings security over real HTTP handlers and PostgreSQL', () => {
  it('persists hashed login sessions, cookie flags, CSRF/origin rejection and rotation/replay revocation', async () => {
    const user = await seed(); const first = await login(user);
    const rawCookies = first.response.headers['set-cookie'] as string[];
    expect(rawCookies.find(c => c.startsWith('zalo_crm_refresh='))).toMatch(/HttpOnly/);
    expect(rawCookies.find(c => c.startsWith('zalo_crm_refresh='))).toMatch(/Path=\/api\/v1\/auth/);
    expect(rawCookies.find(c => c.startsWith('zalo_crm_refresh='))).toMatch(/SameSite=Lax/i);
    expect(rawCookies.find(c => c.startsWith('zalo_crm_csrf='))).not.toMatch(/HttpOnly/);
    const claims = fixture.app.jwt.decode<{ exp: number; iat: number; sessionId: string }>(first.token)!;
    expect(claims.exp - claims.iat).toBe(900);
    const session = await fixture.prisma.authSession.findUniqueOrThrow({ where: { id: claims.sessionId } });
    expect(session.refreshTokenHash).toBe(createHash('sha256').update(first.cookies.zalo_crm_refresh).digest('hex'));
    expect(JSON.stringify(session)).not.toContain(first.cookies.zalo_crm_refresh);
    for (const headers of [{}, { ...refreshHeaders(first.cookies), origin: 'https://foreign.invalid' }, { ...refreshHeaders(first.cookies), 'x-csrf-token': 'wrong' }]) {
      expect((await fixture.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', cookies: first.cookies, headers })).statusCode).toBe(403);
    }
    expect((await fixture.prisma.authSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).toBeNull();
    const rotated = await fixture.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', cookies: first.cookies, headers: refreshHeaders(first.cookies) });
    expect(rotated.statusCode).toBe(200);
    const replacement = await fixture.prisma.authSession.findFirstOrThrow({ where: { familyId: session.familyId, id: { not: session.id } } });
    expect((await fixture.prisma.authSession.findUniqueOrThrow({ where: { id: session.id } })).replacedBySessionId).toBe(replacement.id);
    expect((await fixture.app.inject({ url: '/api/v1/profile', headers: bearer(first.token) })).statusCode).toBe(401);
    expect((await fixture.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', cookies: first.cookies, headers: refreshHeaders(first.cookies) })).statusCode).toBe(401);
    expect((await fixture.app.inject({ url: '/api/v1/profile', headers: bearer(rotated.json().token) })).statusCode).toBe(401);
    expect(await fixture.prisma.authSession.count({ where: { familyId: session.familyId, revokedAt: null } })).toBe(0);
  });

  it('allows only one concurrent refresh rotation and revokes the family after replay', async () => {
    const user = await seed(); const signed = await login(user);
    const responses = await Promise.all(Array.from({ length: 2 }, () => fixture.app.inject({
      method: 'POST', url: '/api/v1/auth/refresh', cookies: signed.cookies, headers: refreshHeaders(signed.cookies),
    })));
    expect(responses.map(response => response.statusCode).sort()).toEqual([200, 401]);
    expect(await fixture.prisma.authSession.count({ where: { userId: user.id } })).toBe(2);
    expect(await fixture.prisma.authSession.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
  });

  it('denies administrator owner takeover and reads current roles for existing bearer sessions', async () => {
    const owner = await seed(); const admin = await seed('admin', owner.orgId); const signed = await login(admin);
    for (const payload of [{ fullName: 'takeover' }, { email: 'takeover@test.invalid' }, { role: 'member' }, { isActive: false }]) {
      expect((await fixture.app.inject({ method: 'PUT', url: `/api/v1/users/${owner.id}`, headers: bearer(signed.token), payload })).statusCode).toBe(403);
    }
    expect((await fixture.app.inject({ method: 'PUT', url: `/api/v1/users/${owner.id}/password`, headers: bearer(signed.token), payload: { password: 'Replacement12345' } })).statusCode).toBe(403);
    expect((await fixture.app.inject({ method: 'DELETE', url: `/api/v1/users/${owner.id}`, headers: bearer(signed.token) })).statusCode).toBe(403);
    expect(await fixture.prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).toMatchObject({ email: owner.email, passwordHash, isActive: true, role: 'owner' });
    await fixture.prisma.user.update({ where: { id: admin.id }, data: { role: 'member' } });
    sessionCache.clear();
    expect((await fixture.app.inject({ url: '/api/v1/profile', headers: bearer(signed.token) })).json().role).toBe('member');
    expect((await fixture.app.inject({ url: '/api/v1/settings/api-key', headers: bearer(signed.token) })).statusCode).toBe(403);
    const ownerLogin = await login(owner);
    expect((await fixture.app.inject({ method: 'PUT', url: `/api/v1/users/${admin.id}`, headers: bearer(ownerLogin.token), payload: { role: 'admin' } })).statusCode).toBe(200);
    expect((await fixture.app.inject({ url: '/api/v1/profile', headers: bearer(signed.token) })).statusCode).toBe(401);
  });

  it('allows owner/admin full API key views with no-store/audit and excludes credentials from logs', async () => {
    const owner = await seed(); const admin = await seed('admin', owner.orgId); const member = await seed('member', owner.orgId);
    const o = await login(owner); const a = await login(admin); const m = await login(member);
    const output = vi.spyOn(console, 'log');
    const generated = await fixture.app.inject({ method: 'POST', url: '/api/v1/settings/api-key/generate', headers: bearer(o.token) });
    expect(generated.statusCode).toBe(200); const key = generated.json().key;
    expect(generated.headers['cache-control']).toBe('no-store');
    const prefix = key.slice(0, 10);
    const maskedKey = `${prefix}••••••••••••••••••••••••••••••••••••••••`;
    for (const token of [o.token, a.token]) {
      const viewed = await fixture.app.inject({ url: '/api/v1/settings/api-key', headers: bearer(token) });
      expect(viewed.statusCode).toBe(200);
      expect(viewed.json()).toEqual({ key: maskedKey, apiKey: maskedKey, maskedKey, prefix });
      expect(viewed.headers['cache-control']).toBe('no-store');
    }
    for (const [method, url] of [['GET', '/api/v1/settings/api-key'], ['POST', '/api/v1/settings/api-key/generate'], ['GET', '/api/v1/settings/webhook'], ['GET', '/api/v1/ai-reports/settings']] as const) {
      expect((await fixture.app.inject({ method, url, headers: bearer(m.token) })).statusCode).toBe(403);
    }
    const audit = await fixture.prisma.activityLog.findMany({ where: { orgId: owner.orgId, entityType: 'api_key' }, orderBy: { createdAt: 'asc' } });
    expect(audit.map(row => row.action)).toEqual(['api_key.rotated', 'api_key.viewed', 'api_key.viewed']);
    expect(audit.map(row => row.userId)).toEqual([owner.id, owner.id, admin.id]);
    expect(JSON.stringify(audit)).not.toContain(key);
    expect(JSON.stringify(output.mock.calls)).not.toContain(key);
  });

  it('dual-reads legacy SMTP/webhook secrets and successful saves clear plaintext without returning credentials', async () => {
    const owner = await seed(); const signed = await login(owner); const headers = bearer(signed.token);
    const smtp = { host: 'smtp.test.invalid', port: 587, auth: { user: 'fixture', pass: 'smtp-fixture-secret' } };
    for (const [settingKey, valuePlain] of [['ai_report_smtp_config', JSON.stringify(smtp)], ['webhook_secret', 'webhook-fixture-secret']]) {
      await fixture.prisma.appSetting.create({ data: { orgId: owner.orgId, settingKey, valuePlain } });
    }
    const { getOrgSmtpConfig } = await import('../../src/modules/ai-reports/email-service.js');
    expect(await getOrgSmtpConfig(owner.orgId)).toEqual(smtp);
    const smtpRead = await fixture.app.inject({ url: '/api/v1/ai-reports/settings', headers });
    expect(smtpRead.statusCode).toBe(200); expect(smtpRead.json().smtp.passSet).toBe(true); expect(smtpRead.body).not.toContain(smtp.auth.pass);
    const webhookRead = await fixture.app.inject({ url: '/api/v1/settings/webhook', headers });
    expect(webhookRead.statusCode).toBe(200); expect(webhookRead.json().secret).toMatch(/^\*+cret$/); expect(webhookRead.body).not.toContain('webhook-fixture-secret');
    expect((await fixture.app.inject({ method: 'PUT', url: '/api/v1/ai-reports/settings', headers, payload: { smtp: { host: 'smtp.updated.invalid' } } })).statusCode).toBe(200);
    expect((await fixture.app.inject({ method: 'PUT', url: '/api/v1/settings/webhook', headers, payload: { url: 'https://webhook.test.invalid', secret: 'webhook-fixture-secret' } })).statusCode).toBe(200);
    const { decodeSecureSetting } = await import('../../src/shared/settings/secure-setting-codec.js');
    for (const settingKey of ['ai_report_smtp_config', 'webhook_secret']) {
      const row = await fixture.prisma.appSetting.findUniqueOrThrow({ where: { orgId_settingKey: { orgId: owner.orgId, settingKey } } });
      expect(row.valuePlain).toBeNull(); expect(row.valueEncrypted?.length).toBeGreaterThan(0);
      expect(decodeSecureSetting(row)).toContain(settingKey === 'webhook_secret' ? 'webhook-fixture-secret' : smtp.auth.pass);
    }
    expect((await getOrgSmtpConfig(owner.orgId))?.auth.pass).toBe(smtp.auth.pass);
    expect((await fixture.app.inject({ url: '/api/v1/ai-reports/settings', headers })).json().smtp.passSet).toBe(true);
    // JSON-looking webhook secrets must remain byte-exact strings through encryption.
    for (const secret of ['1234', 'null', '{\"secret\":1}']) {
      expect((await fixture.app.inject({ method: 'PUT', url: '/api/v1/settings/webhook', headers, payload: { secret } })).statusCode).toBe(200);
      const row = await fixture.prisma.appSetting.findUniqueOrThrow({ where: { orgId_settingKey: { orgId: owner.orgId, settingKey: 'webhook_secret' } } });
      expect(decodeSecureSetting(row)).toBe(secret);
    }
  });

  it('retains prior encrypted secrets when the real database rejects replacement writes', async () => {
    const owner = await seed(); const signed = await login(owner); const headers = bearer(signed.token);
    const { encodeSecureSetting, decodeSecureSetting } = await import('../../src/shared/settings/secure-setting-codec.js');
    for (const settingKey of ['webhook_secret', 'ai_report_smtp_config']) {
      const plain = settingKey === 'webhook_secret' ? 'original-webhook' : JSON.stringify({ host: 'smtp.test.invalid', port: 587, auth: { user: 'fixture', pass: 'original-smtp' } });
      await fixture.prisma.appSetting.create({ data: { orgId: owner.orgId, settingKey, ...encodeSecureSetting(plain) } });
    }
    // A PostgreSQL trigger models a storage failure without replacing Prisma or encryption.
    await fixture.prisma.$executeRawUnsafe(`CREATE FUNCTION reject_fixture_secret_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.setting_key IN ('webhook_secret', 'ai_report_smtp_config') THEN RAISE EXCEPTION 'fixture storage failure'; END IF; RETURN NEW; END $$`);
    await fixture.prisma.$executeRawUnsafe('CREATE TRIGGER reject_fixture_secret_update BEFORE UPDATE ON app_settings FOR EACH ROW EXECUTE FUNCTION reject_fixture_secret_update()');
    try {
      for (const [url, payload] of [['/api/v1/settings/webhook', { secret: 'replacement' }], ['/api/v1/ai-reports/settings', { smtp: { pass: 'replacement' } }]] as const) {
        expect((await fixture.app.inject({ method: 'PUT', url, headers, payload })).statusCode).toBe(500);
      }
      for (const settingKey of ['webhook_secret', 'ai_report_smtp_config']) {
        const row = await fixture.prisma.appSetting.findUniqueOrThrow({ where: { orgId_settingKey: { orgId: owner.orgId, settingKey } } });
        expect(row.valuePlain).toBeNull(); expect(decodeSecureSetting(row)).toContain(settingKey === 'webhook_secret' ? 'original-webhook' : 'original-smtp');
      }
    } finally {
      await fixture.prisma.$executeRawUnsafe('DROP TRIGGER reject_fixture_secret_update ON app_settings');
      await fixture.prisma.$executeRawUnsafe('DROP FUNCTION reject_fixture_secret_update()');
    }
  });

  it('accepts loopback/appOrigin in CORS and assertBrowserRequest while rejecting external untrusted origins', async () => {
    const user = await seed();
    const signed = await login(user);

    // Loopback origin is allowed
    const loopbackRes = await fixture.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: signed.cookies,
      headers: {
        origin: 'http://localhost:3080',
        'x-csrf-token': signed.cookies.zalo_crm_csrf,
      },
    });
    expect(loopbackRes.statusCode).toBe(200);

    // Foreign origin is rejected
    const foreignRes = await fixture.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: signed.cookies,
      headers: {
        origin: 'https://evil-attacker.com',
        'x-csrf-token': signed.cookies.zalo_crm_csrf,
      },
    });
    expect(foreignRes.statusCode).toBe(403);
  });

  it('returns 404 for removed system cron-lease reset endpoint', async () => {
    const res = await fixture.app.inject({
      method: 'POST',
      url: '/api/v1/system/cron-leases/reset',
      payload: { all: true, reason: 'test' },
    });
    expect(res.statusCode).toBe(404);
  });
});
