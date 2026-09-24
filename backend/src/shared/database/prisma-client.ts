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
  get(target, prop) {
    if (prop in target) {
      return Reflect.get(target, prop);
    }
    const value = Reflect.get(activeClient as any, prop, activeClient);
    if (typeof value === 'function') {
      return value.bind(activeClient);
    }
    return value;
  },
  set(target, prop, value) {
    Reflect.set(target, prop, value);
    return Reflect.set(activeClient as any, prop, value, activeClient);
  },
  has(target, prop) {
    return Reflect.has(target, prop) || Reflect.has(activeClient as any, prop);
  },
  getOwnPropertyDescriptor(target, prop) {
    return Reflect.getOwnPropertyDescriptor(target, prop) || Reflect.getOwnPropertyDescriptor(activeClient as any, prop);
  },
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = activeClient;
