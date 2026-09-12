import { open, realpath, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

// Inventory contains identities/counts/reasons only. Private content and request
// payloads belong in the separately protected pre-cutover database backup.
export async function writeReportTargetPreflight(databaseUrl: string, outputPath: string): Promise<void> {
  if (!databaseUrl || !outputPath || !isAbsolute(outputPath)) {
    throw new Error('Explicit database URL and absolute output path required');
  }
  const parent = await realpath(dirname(outputPath));
  const destination = resolve(parent, outputPath.split(sep).at(-1)!);
  const fromRepository = relative(await realpath(repositoryRoot), destination);
  if (!fromRepository || (!fromRepository.startsWith(`..${sep}`) && fromRepository !== '..' && !isAbsolute(fromRepository))) {
    throw new Error('Preflight output must be outside the repository');
  }
  // Exclusive creation also refuses symlink targets and existing artifacts.
  const artifact = await open(destination, 'wx', 0o600);
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000 });
  let complete = false;
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '30s'");
    const configs = await client.query(`
      SELECT cfg.id, cfg.org_id, cfg.zalo_account_id,
        count(c.id)::integer AS candidate_count,
        CASE WHEN cfg.zalo_account_id IS NOT NULL AND bool_or(c.zalo_account_id = cfg.zalo_account_id)
          THEN 'explicit_valid' WHEN cfg.zalo_account_id IS NOT NULL THEN 'explicit_invalid'
          WHEN count(c.id) = 1 THEN 'null_unique' WHEN count(c.id) = 0 THEN 'null_missing'
          ELSE 'null_ambiguous' END AS reason
      FROM group_report_configs cfg
      LEFT JOIN conversations c ON c.org_id = cfg.org_id AND c.external_thread_id = cfg.group_thread_id
        AND c."threadType" = 'group' AND EXISTS (
          SELECT 1 FROM zalo_accounts a WHERE a.id = c.zalo_account_id AND a.org_id = cfg.org_id)
      GROUP BY cfg.id ORDER BY cfg.id`);
    const reports = await client.query('SELECT id, org_id FROM generated_reports ORDER BY id');
    const jobs = await client.query(`SELECT id, org_id, result_report_id,
      CASE WHEN status IN ('succeeded', 'failed', 'cancelled') THEN 'terminal_preserved'
        WHEN request_data -> 'schemaVersion' = '2'::jsonb THEN 'v2_preserved'
        ELSE 'legacy_requires_resubmission' END AS reason
      FROM ai_report_jobs ORDER BY id`);
    const dispatches = await client.query('SELECT id, job_id FROM ai_report_job_dispatches ORDER BY id');
    await client.query('COMMIT');
    const counts = { configs: configs.rowCount, reports: reports.rowCount, jobs: jobs.rowCount, dispatches: dispatches.rowCount };
    await artifact.writeFile(JSON.stringify({ counts, configs: configs.rows, reports: reports.rows, jobs: jobs.rows, dispatches: dispatches.rows }, null, 2));
    await artifact.sync();
    complete = true;
  } finally {
    await client.end().catch(() => undefined);
    await artifact.close();
    if (!complete) await unlink(destination);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const databaseUrl = process.env.REPORT_TARGET_PREFLIGHT_DATABASE_URL;
  const outputPath = process.argv[2];
  if (!databaseUrl || !outputPath) {
    process.stderr.write('Usage: REPORT_TARGET_PREFLIGHT_DATABASE_URL=<explicit URL> tsx scripts/report-target-migration-preflight.ts /protected/output.json\n');
    process.exitCode = 1;
  } else {
    writeReportTargetPreflight(databaseUrl, outputPath).then(() => {
      process.stdout.write('Protected report-target inventory written.\n');
    }).catch(() => {
      // Database errors may contain connection details or private values.
      process.stderr.write('Preflight failed; check connection, permissions and output path. No complete artifact written.\n');
      process.exitCode = 1;
    });
  }
}
