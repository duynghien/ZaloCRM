import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { createServiceDatabase } from './ci-postgres-service.js';

const ownedDatabaseUrls = new Set<string>();
const execFileAsync = promisify(execFile);
const backendRoot = fileURLToPath(new URL('../../', import.meta.url));

export interface DisposablePostgres {
  containerName: string;
  databaseUrl: string;
  stop: () => Promise<void>;
}

function waitForPort(port: number, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const attempt = () => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      const finish = (error?: Error) => {
        socket.removeAllListeners();
        socket.destroy();
        if (error) {
          if (Date.now() - startedAt > timeoutMs) {
            reject(error);
            return;
          }
          setTimeout(attempt, 250);
          return;
        }
        resolve();
      };

      socket.once('connect', () => finish());
      socket.once('error', () => finish(new Error(`Postgres did not open port ${port} in time`)));
    };

    attempt();
  });
}

async function findFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address !== 'object' || !address) {
        reject(new Error('Unable to reserve a free port for Postgres'));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

export function seedBackendTestEnv(databaseUrl: string): void {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_SECRET = 'test-jwt-secret-for-phase1';
  process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
  process.env.APP_URL = 'http://127.0.0.1:3000';
  process.env.GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
}

export async function startDisposablePostgres(): Promise<DisposablePostgres> {
  if (process.env.TEST_POSTGRES_ADMIN_URL) {
    const fixture = await createServiceDatabase(process.env.TEST_POSTGRES_ADMIN_URL);
    ownedDatabaseUrls.add(fixture.databaseUrl);
    return fixture;
  }
  const port = await findFreePort();
  const containerName = `zalocrm-phase1-pg-${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const image = 'postgres:16-alpine';
  const databaseName = 'zalocrm_test';
  const databaseUrl = `postgresql://crmuser:password@127.0.0.1:${port}/${databaseName}?schema=public`;

  await execFileAsync('docker', [
    'run',
    '--rm',
    '-d',
    '--name',
    containerName,
    '-e',
    'POSTGRES_USER=crmuser',
    '-e',
    'POSTGRES_PASSWORD=password',
    '-e',
    `POSTGRES_DB=${databaseName}`,
    '-p',
    `127.0.0.1:${port}:5432`,
    image,
  ], { cwd: backendRoot });

  try {
    await waitForPort(port);
    const deadline = Date.now() + 30_000;
    while (true) {
      try { await execFileAsync('docker', ['exec', containerName, 'pg_isready', '-U', 'crmuser', '-d', databaseName], { cwd: backendRoot }); break; }
      catch (error) { if (Date.now() >= deadline) throw error; await new Promise(resolve => setTimeout(resolve, 250)); }
    }
  } catch (error) {
    await execFileAsync('docker', ['rm', '-f', containerName], { cwd: backendRoot });
    throw error;
  }

  ownedDatabaseUrls.add(databaseUrl);
  let stopped = false;
  return {
    containerName,
    databaseUrl,
    stop: async () => {
      if (stopped) return;
      await execFileAsync('docker', ['rm', '-f', containerName], { cwd: backendRoot });
      stopped = true;
    },
  };
}

export async function migrateDisposablePostgres(databaseUrl: string): Promise<void> {
  if (!ownedDatabaseUrls.has(databaseUrl)) throw new Error('Refusing migration outside a database created by this fixture');
  await execFileAsync('npm', ['exec', '--', 'prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    cwd: backendRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
  });
}
