import { startDisposablePostgres, migrateDisposablePostgres, seedBackendTestEnv } from './disposable-postgres.js';

/** Each suite owns a migrated ephemeral PostgreSQL container and production app. */
export async function createTestApp() {
  const database = await startDisposablePostgres();
  try {
    seedBackendTestEnv(database.databaseUrl);
    await migrateDisposablePostgres(database.databaseUrl);
    const { prisma } = await import('../../src/shared/database/prisma-client.js');
    const { createApp } = await import('../../src/app-factory.js');
    const app = await createApp();
    const url = await app.listen({ host: '127.0.0.1', port: 0 });
    return { app, prisma, url, stopDatabase: database.stop, close: async () => {
      try { await app.close(); } finally { try { await prisma.$disconnect(); } finally { await database.stop(); } }
    } };
  } catch (error) { await database.stop(); throw error; }
}
