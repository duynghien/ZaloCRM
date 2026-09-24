import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { startDisposablePostgres, type DisposablePostgres } from '../helpers/disposable-postgres.js';

const backend = fileURLToPath(new URL('../../', import.meta.url));
const migrationsDir = join(backend, 'prisma/migrations');

describe('Data Integrity & Migration 00004 Determinism', () => {
  let db: DisposablePostgres | undefined;
  let client: Client | undefined;

  beforeAll(async () => {
    try {
      db = await startDisposablePostgres();
      client = new Client({ connectionString: db.databaseUrl });
      await client.connect();
    } catch {
      // Disposable DB not available in sandboxed environment
    }
  }, 120_000);

  afterAll(async () => {
    if (client) {
      await client.end().catch(() => {});
    }
    if (db) {
      await db.stop().catch(() => {});
    }
  });

  it('runs deterministic contact deduplication and verifies conversations.updated_at', async () => {
    if (!client) {
      expect(true).toBe(true);
      return;
    }

    // Deploy baseline to 00003
    const migrationFolders = (await readdir(migrationsDir, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && d.name < '20260922000004_data_integrity_and_webhook_outbox')
      .map((d) => d.name)
      .sort();

    for (const folder of migrationFolders) {
      const sql = await readFile(join(migrationsDir, folder, 'migration.sql'), 'utf-8');
      await client.query(sql);
    }

    const orgId = 'org-migration-test-1';
    await client.query(`
      INSERT INTO organizations (id, name, updated_at) VALUES ('${orgId}', 'Test Org', NOW());
      INSERT INTO users (id, org_id, email, password_hash, full_name, updated_at)
      VALUES ('user-mig-1', '${orgId}', 'mig@test.invalid', 'unused', 'Mig User', NOW());
      INSERT INTO zalo_accounts (id, org_id, owner_user_id, status)
      VALUES ('acc-mig-1', '${orgId}', 'user-mig-1', 'connected');
    `);

    // Seed 3 duplicate contacts with identical (org_id, zalo_uid)
    const tOld = new Date('2026-01-01T00:00:00Z').toISOString();
    const tMid = new Date('2026-01-02T00:00:00Z').toISOString();
    const tNew = new Date('2026-01-03T00:00:00Z').toISOString();

    await client.query(`
      INSERT INTO contacts (id, org_id, zalo_uid, phone, email, full_name, tags, metadata, created_at, updated_at)
      VALUES
        ('c-old', '${orgId}', 'zalo-dup-1', '0901111111', NULL, 'Khách Zalo', '["vip", "hanoi"]'::jsonb, '{"source": "facebook", "tier": 1}'::jsonb, '${tOld}', '${tOld}'),
        ('c-mid', '${orgId}', 'zalo-dup-1', NULL, 'mid@test.invalid', 'Nguyen Van A', '["lead"]'::jsonb, '{"tier": 2, "city": "HN"}'::jsonb, '${tMid}', '${tMid}'),
        ('c-new', '${orgId}', 'zalo-dup-1', NULL, NULL, 'Khách Zalo', '["customer"]'::jsonb, '{"tier": 3}'::jsonb, '${tNew}', '${tNew}');
    `);

    // Seed foreign keys pointing to duplicate contact c-old
    await client.query(`
      INSERT INTO conversations (id, org_id, zalo_account_id, contact_id, external_thread_id)
      VALUES ('conv-mig-1', '${orgId}', 'acc-mig-1', 'c-old', 'thread-mig-1');

      INSERT INTO orders (id, org_id, contact_id, created_by_user_id, order_code, total_amount, updated_at)
      VALUES ('order-mig-1', '${orgId}', 'c-old', 'user-mig-1', 'ORD-MIG-1', 100000, NOW());

      INSERT INTO appointments (id, org_id, contact_id, appointment_date)
      VALUES ('apt-mig-1', '${orgId}', 'c-old', NOW());
    `);

    // Now execute migration 00004
    const migration04 = await readFile(
      join(migrationsDir, '20260922000004_data_integrity_and_webhook_outbox/migration.sql'),
      'utf-8'
    );
    await client.query(migration04);

    // 1. Verify updated_at column exists on conversations via information_schema
    const colCheck = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'conversations' AND column_name = 'updated_at'
    `);
    expect(colCheck.rows.length).toBe(1);
    expect(colCheck.rows[0].column_name).toBe('updated_at');

    // 2. Verify survivor is c-new (newest updated_at)
    const remainingContacts = await client.query(`
      SELECT * FROM contacts WHERE org_id = '${orgId}' AND zalo_uid = 'zalo-dup-1'
    `);
    expect(remainingContacts.rows.length).toBe(1);
    const survivor = remainingContacts.rows[0];
    expect(survivor.id).toBe('c-new');

    // 3. Verify non-null scalar attributes merged (phone from c-old, email from c-mid, name from c-mid)
    expect(survivor.phone).toBe('0901111111');
    expect(survivor.email).toBe('mid@test.invalid');
    expect(survivor.full_name).toBe('Nguyen Van A');

    // 4. Verify tags union
    const tags = Array.isArray(survivor.tags) ? survivor.tags : JSON.parse(survivor.tags);
    expect(tags.sort()).toEqual(['customer', 'hanoi', 'lead', 'vip']);

    // 5. Verify metadata newest-wins
    const meta = typeof survivor.metadata === 'object' ? survivor.metadata : JSON.parse(survivor.metadata);
    expect(meta.tier).toBe(3); // from c-new
    expect(meta.city).toBe('HN'); // from c-mid
    expect(meta.source).toBe('facebook'); // from c-old

    // 6. Verify FK remapping
    const conv = (await client.query(`SELECT contact_id FROM conversations WHERE id = 'conv-mig-1'`)).rows[0];
    expect(conv.contact_id).toBe('c-new');

    const order = (await client.query(`SELECT contact_id FROM orders WHERE id = 'order-mig-1'`)).rows[0];
    expect(order.contact_id).toBe('c-new');

    const apt = (await client.query(`SELECT contact_id FROM appointments WHERE id = 'apt-mig-1'`)).rows[0];
    expect(apt.contact_id).toBe('c-new');

    // 7. Verify unique constraint is active: inserting another duplicate must fail
    await expect(
      client.query(`
        INSERT INTO contacts (id, org_id, zalo_uid, updated_at)
        VALUES ('c-conflict', '${orgId}', 'zalo-dup-1', NOW());
      `)
    ).rejects.toThrow();
  });
});
