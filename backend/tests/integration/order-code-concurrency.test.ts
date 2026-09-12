import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { expect, it } from 'vitest';
import { migrateDisposablePostgres, startDisposablePostgres } from '../helpers/disposable-postgres.js';
import { allocateOrderCode } from '../../src/modules/orders/order-code-service.js';
import { writeOrderCodePreflight } from '../../scripts/order-code-preflight.js';

const exec = promisify(execFile);
const backend = fileURLToPath(new URL('../../', import.meta.url));
const migrations = join(backend, 'prisma/migrations');
const migrationName = '20260910000000_unique_order_codes';
const instant = new Date('2026-09-10T00:00:00Z');

async function legacySchema(databaseUrl: string, directory: string) {
  const target = join(directory, 'migrations');
  await mkdir(target);
  // Deploy the historical prefix only; newer migrations are part of the upgrade under test.
  for (const entry of await readdir(migrations, { withFileTypes: true })) {
    if (entry.name === 'migration_lock.toml' || (entry.isDirectory() && entry.name < migrationName)) {
      await cp(join(migrations, entry.name), join(target, entry.name), { recursive: true });
    }
  }
  const config = join(directory, 'prisma.config.ts');
  await writeFile(config, `export default { schema: ${JSON.stringify(join(backend, 'prisma/schema.prisma'))}, migrations: {path: ${JSON.stringify(target)}}, datasource: {url: process.env.DATABASE_URL} };`);
  await exec('npm', ['exec', '--', 'prisma', 'migrate', 'deploy', '--config', config], { cwd: backend, env: { ...process.env, DATABASE_URL: databaseUrl } });
}

async function seedEntities(client: Client) {
  await client.query(`INSERT INTO organizations(id,name,updated_at) VALUES ('org','Fixture',now()),('other','Other',now());
    INSERT INTO users(id,org_id,email,password_hash,full_name,updated_at) VALUES ('user','org','order@test.invalid','unused','Test',now());
    INSERT INTO contacts(id,org_id,updated_at) VALUES ('contact','org',now()),('other-contact','other',now());`);
}

function createOrder(prisma: PrismaClient, orgId = 'org', now = instant) {
  return prisma.$transaction(async tx => {
    const orderCode = await allocateOrderCode(tx, orgId, now);
    return tx.order.create({ data: { orgId, contactId: orgId === 'org' ? 'contact' : 'other-contact', createdByUserId: 'user', orderCode, totalAmount: 1 } });
  }, { maxWait: 30_000, timeout: 20_000 });
}

it('migrates sparse legacy suffixes, blocks duplicates, preserves malformed codes and rolls back interrupted DDL', async () => {
  const db = await startDisposablePostgres();
  const directory = await mkdtemp(join(tmpdir(), 'order-code-migration-'));
  const client = new Client({ connectionString: db.databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: db.databaseUrl }) });
  try {
    await legacySchema(db.databaseUrl, directory);
    await client.connect();
    const appliedLegacy = (await client.query('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL')).rows.map(row => row.migration_name as string).sort();
    const expectedLegacy = (await readdir(migrations, { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name < migrationName).map(entry => entry.name).sort();
    expect(appliedLegacy).toEqual(expectedLegacy);
    expect(appliedLegacy.length).toBeGreaterThan(0);
    expect((await client.query("SELECT to_regclass('order_code_counters') AS name")).rows[0].name).toBeNull();
    await seedEntities(client);
    await client.query(`INSERT INTO orders(id,org_id,contact_id,created_by_user_id,order_code,total_amount,updated_at) VALUES
      ('sparse','org','contact','user','ORD-20260910-009',1,now()),
      ('maximum','org','contact','user','ORD-20260910-999',1,now()),
      ('invalid','org','contact','user','private-legacy-code',1,now()),
      ('calendar','org','contact','user','ORD-20260230-100000',1,now()),
      ('other','other','other-contact','user','ORD-20260910-009',1,now()),
      ('duplicate','org','contact','user','ORD-20260910-009',1,now());`);
    const before = (await client.query('SELECT * FROM orders ORDER BY id')).rows;
    const blockedArtifact = join(directory, 'blocked.json');
    expect(await writeOrderCodePreflight(db.databaseUrl, blockedArtifact)).toBe(false);
    const blockedText = await readFile(blockedArtifact, 'utf8');
    const inventory = JSON.parse(blockedText);
    expect(inventory.counts).toEqual({ orders: 6, duplicateGroups: 1, nonconforming: 2, exhaustedCounters: 0 });
    expect(blockedText).not.toContain('private-legacy-code');
    expect((await stat(blockedArtifact)).mode & 0o777).toBe(0o600);
    expect(inventory.counters).toContainEqual({ org_id: 'org', date_key: '20260910', max_suffix: '999' });
    await expect(writeOrderCodePreflight(db.databaseUrl, join(backend, 'forbidden-order-inventory.json'))).rejects.toThrow('outside');
    const sql = await readFile(join(migrations, migrationName, 'migration.sql'), 'utf8');
    await expect(client.query(sql)).rejects.toThrow('duplicate_order_codes_require_operator_resolution');
    await client.query('ROLLBACK');
    expect((await client.query('SELECT * FROM orders ORDER BY id')).rows).toEqual(before);
    expect((await client.query("SELECT to_regclass('order_code_counters') AS name")).rows[0].name).toBeNull();
    // Explicit fixture cleanup models an operator resolution; migration never changes codes.
    await client.query("DELETE FROM orders WHERE id='duplicate'");
    expect(await writeOrderCodePreflight(db.databaseUrl, join(directory, 'ready.json'))).toBe(true);
    await expect(client.query(sql.replace('COMMIT;', 'SELECT 1 / 0; COMMIT;'))).rejects.toThrow('division by zero');
    await client.query('ROLLBACK');
    expect((await client.query("SELECT to_regclass('order_code_counters') AS name")).rows[0].name).toBeNull();
    await migrateDisposablePostgres(db.databaseUrl);
    expect((await client.query('SELECT * FROM orders ORDER BY id')).rows).toEqual(before.filter(row => row.id !== 'duplicate'));
    expect((await createOrder(prisma)).orderCode).toBe('ORD-20260910-1000');
    const counters = await prisma.orderCodeCounter.findMany({ orderBy: { orgId: 'asc' } });
    await migrateDisposablePostgres(db.databaseUrl);
    expect(await prisma.orderCodeCounter.findMany({ orderBy: { orgId: 'asc' } })).toEqual(counters);
  } finally {
    await prisma.$disconnect(); await client.end(); await db.stop(); await rm(directory, { recursive: true, force: true });
  }
}, 120_000);

it('allocates 50 concurrent orders uniquely and preserves UTC, organization, deletion and rollback invariants', async () => {
  const db = await startDisposablePostgres();
  const client = new Client({ connectionString: db.databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: db.databaseUrl, max: 20 }) });
  try {
    await migrateDisposablePostgres(db.databaseUrl);
    await client.connect();
    await seedEntities(client);
    const orders = await Promise.all(Array.from({ length: 50 }, () => createOrder(prisma)));
    expect(new Set(orders.map(order => order.orderCode)).size).toBe(50);
    expect(orders.map(order => order.orderCode).sort()).toEqual(Array.from({ length: 50 }, (_, i) => `ORD-20260910-${String(i + 1).padStart(3, '0')}`));
    expect((await createOrder(prisma, 'other')).orderCode).toBe('ORD-20260910-001');
    await prisma.order.delete({ where: { orgId_orderCode: { orgId: 'org', orderCode: 'ORD-20260910-050' } } });
    expect((await createOrder(prisma)).orderCode).toBe('ORD-20260910-051');
    const count = await prisma.order.count();
    await expect(prisma.$transaction(async tx => {
      const orderCode = await allocateOrderCode(tx, 'org', instant);
      await tx.order.create({ data: { orgId: 'org', contactId: 'contact', createdByUserId: 'user', orderCode, totalAmount: 1 } });
      throw new Error('rollback fixture');
    })).rejects.toThrow('rollback fixture');
    expect(await prisma.order.count()).toBe(count);
    expect((await createOrder(prisma)).orderCode).toBe('ORD-20260910-052');
    expect((await createOrder(prisma, 'org', new Date('2026-09-10T00:00:00+07:00'))).orderCode).toBe('ORD-20260909-001');
    await expect(prisma.order.create({ data: { orgId: 'org', contactId: 'contact', createdByUserId: 'user', orderCode: orders[0]!.orderCode, totalAmount: 1 } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(prisma.$transaction(tx => allocateOrderCode(tx, 'org', new Date('invalid')))).rejects.toThrow('Invalid order allocation date');
  } finally { await prisma.$disconnect(); await client.end(); await db.stop(); }
}, 120_000);
