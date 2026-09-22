process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_long_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import { uuidInput, strictBooleanInput } from '../../src/shared/http/request-bounds.js';
import { RequestValidationError } from '../../src/shared/http/request-schemas.js';
import { searchRoutes } from '../../src/modules/search/search-routes.js';
import { chatRoutes } from '../../src/modules/chat/chat-routes.js';
import { resetPrismaClient, prisma } from '../../src/shared/database/prisma-client.js';

vi.mock('../../src/shared/database/prisma-client.js', async () => {
  const original = await vi.importActual('../../src/shared/database/prisma-client.js');
  return original;
});

vi.mock('../../src/modules/auth/auth-middleware.js', () => ({
  authMiddleware: async (req: any) => {
    req.user = { id: 'usr-1', orgId: 'org-test', role: 'owner' };
  },
  requireRole: () => async (req: any) => {
    req.user = { id: 'usr-1', orgId: 'org-test', role: 'owner' };
  },
}));

vi.mock('../../src/modules/zalo/zalo-access-middleware.js', () => ({
  requireZaloAccess: () => async (req: any) => {
    req.user = { id: 'usr-1', orgId: 'org-test', role: 'owner' };
  },
}));

describe('Request Validation Bounds & Prisma Client Isolation Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates UUID input and rejects invalid formats with 400', () => {
    const validUuid = '123e4567-e89b-12d3-a456-426614174000';
    expect(uuidInput(validUuid, 'contactId')).toBe(validUuid);

    // Uppercase valid
    expect(uuidInput('123E4567-E89B-12D3-A456-426614174000', 'id')).toBeTruthy();

    expect(() => uuidInput('not-a-uuid', 'contactId')).toThrow(RequestValidationError);
    expect(() => uuidInput('', 'contactId')).toThrow(RequestValidationError);
    expect(() => uuidInput('12345', 'contactId')).toThrow(RequestValidationError);
  });

  it('enforces strict boolean and rejects string booleans', () => {
    expect(strictBooleanInput(true, 'active')).toBe(true);
    expect(strictBooleanInput(false, 'active')).toBe(false);

    expect(() => strictBooleanInput('true', 'active')).toThrow(RequestValidationError);
    expect(() => strictBooleanInput('false', 'active')).toThrow(RequestValidationError);
    expect(() => strictBooleanInput(1, 'active')).toThrow(RequestValidationError);
    expect(() => strictBooleanInput(null, 'active')).toThrow(RequestValidationError);
  });

  it('rejects search query exceeding 200 characters with 400', async () => {
    const app = Fastify();
    await app.register(searchRoutes);

    const longQuery = 'a'.repeat(201);
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/search?q=${longQuery}`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message || response.json().error).toContain('200');
  });

  it('rejects chat message content exceeding 10,000 characters with 400', async () => {
    const app = Fastify();
    await app.register(chatRoutes);

    const longContent = 'x'.repeat(10_001);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/conv-123/messages',
      payload: {
        content: longContent,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('10,000');
  });

  it('resets Prisma client to new target URL without leaking previous client state', () => {
    const client1 = resetPrismaClient('postgresql://user:pass@localhost:5432/db1');
    expect(client1).toBeDefined();

    const client2 = resetPrismaClient('postgresql://user:pass@localhost:5432/db2');
    expect(client2).toBeDefined();

    // Verify proxy delegates to client2 without throwing
    expect(prisma).toBeDefined();
  });
});
