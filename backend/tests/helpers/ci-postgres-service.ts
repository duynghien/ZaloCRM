import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import type { DisposablePostgres } from './disposable-postgres.js';

/** CI owns the service; each suite creates and drops only its own random database. */
export async function createServiceDatabase(adminUrl: string): Promise<DisposablePostgres> {
  const url = new URL(adminUrl);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.pathname !== '/zalocrm_test_admin' || url.username !== 'test_fixture') {
    throw new Error('Test PostgreSQL service must use the dedicated loopback fixture administrator');
  }
  const databaseName = `zalocrm_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const identity = await admin.query('SELECT current_database() AS name');
    if (identity.rows[0].name !== 'zalocrm_test_admin') throw new Error('Unexpected fixture database identity');
    await admin.query(`CREATE DATABASE "${databaseName}"`);
  } finally { await admin.end(); }
  url.pathname = `/${databaseName}`;
  let stopped = false;
  return {
    containerName: `ci-service/${databaseName}`,
    databaseUrl: url.toString(),
    stop: async () => {
      if (stopped) return;
      const cleanup = new Client({ connectionString: adminUrl });
      await cleanup.connect();
      try {
        await cleanup.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
        stopped = true;
      } finally { await cleanup.end(); }
    },
  };
}
