import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { expect, it } from 'vitest';
import { migrateDisposablePostgres, startDisposablePostgres } from '../helpers/disposable-postgres.js';
import { writeReportTargetPreflight } from '../../scripts/report-target-migration-preflight.js';

const exec = promisify(execFile);
const backend = fileURLToPath(new URL('../../', import.meta.url));
const migrationName = '20260909090000_account_qualified_report_targets';
const migrations = join(backend, 'prisma/migrations');

async function deployLegacy(databaseUrl: string, directory: string) {
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

async function seedLegacy(client: Client) {
  await client.query(`
    INSERT INTO organizations(id,name,updated_at) VALUES ('org','Fixture',now()),('foreign','Foreign',now());
    INSERT INTO users(id,org_id,email,password_hash,full_name,updated_at) VALUES ('user','org','migration@test.invalid','unused','Test',now());
    INSERT INTO zalo_accounts(id,org_id,owner_user_id) VALUES ('a','org','user'),('b','org','user'),('foreign-account','foreign','user');
    INSERT INTO conversations(id,org_id,zalo_account_id,external_thread_id,"threadType") VALUES
      ('cv','org','a','valid','group'),('cu','org','a','unique','group'),
      ('ca','org','a','ambiguous','group'),('cb','org','b','ambiguous','group'),
      ('ci','org','a','invalid','group'),('cf','org','a','cross-org','group'),
      ('user-decoy','org','a','missing','user');
    INSERT INTO group_report_configs(id,org_id,group_thread_id,zalo_account_id,custom_prompt,updated_at) VALUES
      ('valid','org','valid','a','private-prompt',now()),('unique','org','unique',NULL,'private-prompt',now()),
      ('ambiguous','org','ambiguous',NULL,'private-prompt',now()),('missing','org','missing',NULL,'private-prompt',now()),
      ('invalid','org','invalid','deleted-account','private-prompt',now()),('cross-org','org','cross-org','foreign-account','private-prompt',now());
    INSERT INTO generated_reports(id,org_id,title,period_from,period_to,summary_content,structured_data,sent_zalo,sent_email,metadata)
      VALUES ('report','org','private-title',now(),now(),'private-summary','{"private":"structured"}',true,true,'{"private":"metadata"}');
    INSERT INTO ai_report_jobs(id,org_id,created_by_id,idempotency_key,schedule_key,status,request_data,result_report_id,cancellation_requested_at,lease_owner,lease_expires_at,updated_at)
      VALUES ('queued','org','user','key-queued','schedule-queued','queued','{"schemaVersion":1,"private":"request"}','report',now(),'old-worker',now()+interval '1 hour',now()),
      ('running','org','user','key-running',NULL,'running','{"groupThreadIds":["valid"]}',NULL,NULL,'old-worker',now()+interval '1 hour',now()),
      ('terminal','org','user','key-terminal',NULL,'succeeded','{"schemaVersion":1}',NULL,NULL,NULL,NULL,now());
    INSERT INTO ai_report_job_dispatches(id,job_id,channel,status,lease_owner,lease_expires_at,error_message,updated_at) VALUES
      ('claimed','queued','zalo','claimed','old-worker',now()+interval '1 hour','private-error',now()),
      ('sent','queued','email','sent',NULL,NULL,NULL,now()),('failed','running','zalo','failed',NULL,NULL,'private-error',now());
  `);
}

const rows = async (client: Client, table: string) => (await client.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
async function snapshot(client: Client) {
  const result = [];
  for (const table of ['group_report_configs', 'generated_reports', 'ai_report_jobs', 'ai_report_job_dispatches']) result.push(await rows(client, table));
  return result;
}

it('upgrades every legacy class atomically, preserves history and reruns through Prisma', async () => {
  const db = await startDisposablePostgres();
  const directory = await mkdtemp(join(tmpdir(), 'report-target-migration-'));
  const client = new Client({ connectionString: db.databaseUrl });
  try {
    await deployLegacy(db.databaseUrl, directory);
    await client.connect();
    const appliedLegacy = (await client.query('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL')).rows.map(row => row.migration_name as string).sort();
    const expectedLegacy = (await readdir(migrations, { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name < migrationName).map(entry => entry.name).sort();
    expect(appliedLegacy).toEqual(expectedLegacy);
    expect(appliedLegacy.length).toBeGreaterThan(0);
    expect((await client.query("SELECT to_regclass('order_code_counters') AS name")).rows[0].name).toBeNull();
    await seedLegacy(client);
    const originalConfigs = await rows(client, 'group_report_configs');
    const originalReports = await rows(client, 'generated_reports');
    const originalJobs = await rows(client, 'ai_report_jobs');
    const originalDispatches = await rows(client, 'ai_report_job_dispatches');
    const artifact = join(directory, 'preflight.json');
    await writeReportTargetPreflight(db.databaseUrl, artifact);
    const inventoryText = await readFile(artifact, 'utf8');
    const inventory = JSON.parse(inventoryText);
    expect(inventory.counts).toEqual({ configs: 6, reports: 1, jobs: 3, dispatches: 3 });
    expect(inventoryText).not.toContain('private');
    expect((await stat(artifact)).mode & 0o777).toBe(0o600);
    await expect(writeReportTargetPreflight(db.databaseUrl, artifact)).rejects.toThrow();
    await expect(writeReportTargetPreflight(db.databaseUrl, join(backend, 'forbidden-preflight.json'))).rejects.toThrow('outside');
    await symlink(backend, join(directory, 'repository-link'));
    await expect(writeReportTargetPreflight(db.databaseUrl, join(directory, 'repository-link/forbidden.json'))).rejects.toThrow('outside');
    expect(await rows(client, 'group_report_configs')).toEqual(originalConfigs);

    // Simulate interrupted execution after all DDL/data conversions but before commit.
    const sql = await readFile(join(migrations, migrationName, 'migration.sql'), 'utf8');
    await expect(client.query(sql.replace('COMMIT;', 'SELECT 1 / 0; COMMIT;'))).rejects.toThrow('division by zero');
    await client.query('ROLLBACK');
    expect(await rows(client, 'group_report_configs')).toEqual(originalConfigs);
    expect(await rows(client, 'generated_reports')).toEqual(originalReports);
    expect(await rows(client, 'ai_report_jobs')).toEqual(originalJobs);
    expect(await rows(client, 'ai_report_job_dispatches')).toEqual(originalDispatches);

    await migrateDisposablePostgres(db.databaseUrl);
    const configs = await rows(client, 'group_report_configs');
    expect(configs).toHaveLength(6);
    for (const cfg of configs) {
      const original = originalConfigs.find(row => row.id === cfg.id)!;
      const resolved = ['valid', 'unique'].includes(cfg.id);
      expect(cfg).toMatchObject({ id: original.id, custom_prompt: original.custom_prompt,
        zalo_account_id: resolved ? 'a' : null, is_enabled: resolved,
        target_resolution_status: resolved ? 'resolved' : 'needs_resolution' });
      expect(cfg.legacy_target_data).toMatchObject({ zaloAccountId: original.zalo_account_id, isEnabled: true });
      expect(cfg.legacy_target_data.resolutionReason).toBe(inventory.configs.find((row: { id: string }) => row.id === cfg.id).reason);
    }
    expect(await rows(client, 'generated_reports')).toEqual(originalReports.map(report => ({ ...report,
      source_targets: null, target_schema_version: 1, target_resolution_status: 'legacy_unverified' })));
    expect(await rows(client, 'ai_report_job_dispatches')).toEqual(originalDispatches.map(dispatch => ({ ...dispatch,
      sent_parts: 0, total_parts: null, delivery_uncertain: false })));
    for (const job of await rows(client, 'ai_report_jobs')) {
      const original = originalJobs.find(row => row.id === job.id)!;
      if (job.id === 'terminal') expect(job).toEqual(original);
      else {
        expect(job).toMatchObject({ status: 'failed', error_message: 'legacy_report_targets_require_resubmission', lease_owner: null, lease_expires_at: null });
        for (const key of ['id', 'idempotency_key', 'schedule_key', 'request_data', 'result_report_id', 'cancellation_requested_at']) expect(job[key]).toEqual(original[key]);
      }
    }
    await expect(client.query("UPDATE group_report_configs SET is_enabled=true WHERE id='ambiguous'")).rejects.toThrow('resolution_check');
    await expect(client.query("UPDATE generated_reports SET target_schema_version=2,target_resolution_status='verified',source_targets='[]' WHERE id='report'")).rejects.toThrow('targets_check');
    await client.query("INSERT INTO group_report_configs(id,org_id,group_thread_id,zalo_account_id,updated_at) VALUES ('valid-b','org','valid','b',now())");
    await expect(client.query("INSERT INTO group_report_configs(id,org_id,group_thread_id,zalo_account_id,updated_at) VALUES ('duplicate-a','org','valid','a',now())")).rejects.toThrow('unique');
    await client.query("INSERT INTO ai_report_budget_reservations(id,job_id,attempt_key,lease_owner,lease_expires_at,input_tokens,output_tokens,updated_at) VALUES ('budget','queued','attempt','worker',now(),10,20,now())");
    await expect(client.query("INSERT INTO ai_report_budget_reservations(id,job_id,attempt_key,lease_owner,lease_expires_at,input_tokens,output_tokens,updated_at) VALUES ('budget-duplicate','queued','attempt','new-worker',now(),10,20,now())")).rejects.toThrow('unique');
    await expect(client.query("UPDATE ai_report_budget_reservations SET output_tokens=-1 WHERE id='budget'")).rejects.toThrow('tokens_check');
    await client.query("INSERT INTO ai_report_resends(id,org_id,requested_by_id,report_id,idempotency_key,request_data,updated_at) VALUES ('resend','org','user','report','resend-key','{}',now())");
    await expect(client.query("INSERT INTO ai_report_resends(id,org_id,requested_by_id,report_id,idempotency_key,request_data,updated_at) VALUES ('duplicate-resend','org','user','report','resend-key','{}',now())")).rejects.toThrow('unique');
    await client.query("INSERT INTO ai_report_resend_dispatches(id,resend_id,channel,updated_at) VALUES ('resend-zalo','resend','zalo',now())");
    await expect(client.query("INSERT INTO ai_report_resend_dispatches(id,resend_id,channel,updated_at) VALUES ('duplicate-dispatch','resend','zalo',now())")).rejects.toThrow('unique');
    await expect(client.query("UPDATE ai_report_resend_dispatches SET total_parts=1,sent_parts=2 WHERE id='resend-zalo'")).rejects.toThrow('parts_check');
    const beforeRerun = await snapshot(client);
    await migrateDisposablePostgres(db.databaseUrl);
    expect(await snapshot(client)).toEqual(beforeRerun);
  } finally {
    await client.end();
    await db.stop();
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);

it('deploys the complete migration chain to an empty disposable PostgreSQL database', async () => {
  const db = await startDisposablePostgres();
  const client = new Client({ connectionString: db.databaseUrl });
  try {
    await migrateDisposablePostgres(db.databaseUrl);
    await client.connect();
    for (const table of ['ai_report_budget_reservations', 'ai_report_resends', 'ai_report_resend_dispatches']) expect(await rows(client, table)).toEqual([]);
    expect((await client.query('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL')).rows.map(row => row.migration_name)).toContain(migrationName);
  } finally { await client.end(); await db.stop(); }
}, 120_000);
