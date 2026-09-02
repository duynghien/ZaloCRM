import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const backendRoot = fileURLToPath(new URL('..', import.meta.url));
const source = (path: string) => readFile(new URL(path, `file://${backendRoot}/`), 'utf8');

describe('release P1 security contracts', () => {
  it('keeps current session validation and owner takeover prevention in the auth boundary', async () => {
    const [authService, userRoutes] = await Promise.all([
      source('src/modules/auth/auth-service.ts'),
      source('src/modules/auth/user-routes.ts'),
    ]);
    expect(authService).toContain('validateSessionUser');
    expect(authService).toContain("expiresIn: config.accessTokenTtl");
    expect(authService).toContain("revokeSessionFamily");
    expect(userRoutes).toContain("target.role === 'owner'");
    expect(userRoutes).toContain("await revokeUserSessions");
  });

  it('keeps tenant, ACL, integrity, API-key, and runtime safeguards at their boundaries', async () => {
    const [orders, chat, api, app, schema] = await Promise.all([
      source('src/modules/orders/order-routes.ts'),
      source('src/modules/chat/chat-routes.ts'),
      source('src/modules/api/webhook-settings-routes.ts'),
      source('src/app.ts'),
      source('prisma/schema.prisma'),
    ]);
    expect(orders.match(/orgId: user\.orgId/g)?.length).toBeGreaterThan(5);
    expect(chat).toContain('requireZaloAccess');
    expect(api).toContain("Cache-Control', 'no-store'");
    expect(api).toContain('audit');
    expect(app).toContain('reply.status(503)');
    expect(app).toContain('process.exit(exitCode)');
    expect(schema).toContain('model AuthSession');
    expect(schema).toContain('model AiReportJob');
  });
});
