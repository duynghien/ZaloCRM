/**
 * Prisma client singleton.
 * Prisma 7 requires an adapter for database connection.
 * Reuses the same client instance across hot-reloads in development,
 * and allows isolated re-instantiation in integration test environments.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function createPrismaClient(url?: string): PrismaClient {
  const connectionString = url || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  });
}

let activeClient: PrismaClient = globalForPrisma.prisma || createPrismaClient();

export function resetPrismaClient(url?: string): PrismaClient {
  if (activeClient) {
    void activeClient.$disconnect().catch(() => {});
  }
  activeClient = createPrismaClient(url);
  globalForPrisma.prisma = activeClient;
  return activeClient;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const value = Reflect.get(activeClient as any, prop, activeClient);
    if (typeof value === 'function') {
      return value.bind(activeClient);
    }
    return value;
  },
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = activeClient;
