import { open, realpath, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

/** Returns false when duplicates or an exhausted counter require operator action. */
export async function writeOrderCodePreflight(databaseUrl: string, outputPath: string): Promise<boolean> {
  if (!databaseUrl || !outputPath || !isAbsolute(outputPath)) throw new Error('Explicit database URL and absolute output path required');
  const parent = await realpath(dirname(outputPath));
  const destination = resolve(parent, outputPath.split(sep).at(-1)!);
  const fromRepository = relative(await realpath(repositoryRoot), destination);
  if (!fromRepository || (!fromRepository.startsWith(`..${sep}`) && fromRepository !== '..' && !isAbsolute(fromRepository))) {
    throw new Error('Preflight output must be outside the repository');
  }
  const artifact = await open(destination, 'wx', 0o600);
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000 });
  let complete = false;
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '30s'");
    const duplicates = await client.query(`SELECT org_id,array_agg(id ORDER BY id) AS order_ids,count(*)::integer AS count
      FROM orders GROUP BY org_id,order_code HAVING count(*) > 1 ORDER BY org_id,min(id)`);
    const classified = await client.query(`WITH matched AS (
      SELECT id,org_id,regexp_match(order_code,'^ORD-([0-9]{8})-([0-9]{3,})$') AS parts FROM orders
    ) SELECT id,org_id,parts[1] AS date_key,parts[2] AS suffix,
      COALESCE(parts IS NOT NULL AND substring(parts[1],1,4)::integer > 0 AND to_char(DATE '2000-01-01'
        + (substring(parts[1],1,4)::integer - 2000) * INTERVAL '1 year'
        + (substring(parts[1],5,2)::integer - 1) * INTERVAL '1 month'
        + (substring(parts[1],7,2)::integer - 1) * INTERVAL '1 day','YYYYMMDD') = parts[1],false) AS valid
      FROM matched ORDER BY id`);
    await client.query('COMMIT');
    const invalid: Array<{ id: string; org_id: string; reason: string }> = [];
    const maxima = new Map<string, { org_id: string; date_key: string; max_suffix: string }>();
    for (const row of classified.rows) {
      if (!row.valid) { invalid.push({ id: row.id, org_id: row.org_id, reason: 'nonconforming_code_preserved' }); continue; }
      const key = JSON.stringify([row.org_id, row.date_key]);
      const current = maxima.get(key);
      if (!current || BigInt(row.suffix) > BigInt(current.max_suffix)) maxima.set(key, { org_id: row.org_id, date_key: row.date_key, max_suffix: BigInt(row.suffix).toString() });
    }
    const counters = [...maxima.values()];
    const exhausted = counters.filter(row => BigInt(row.max_suffix) >= 9223372036854775807n);
    const inventory = { counts: { orders: classified.rowCount, duplicateGroups: duplicates.rowCount, nonconforming: invalid.length, exhaustedCounters: exhausted.length }, duplicates: duplicates.rows, nonconforming: invalid, counters, exhausted };
    await artifact.writeFile(JSON.stringify(inventory, null, 2));
    await artifact.sync();
    complete = true;
    return duplicates.rowCount === 0 && exhausted.length === 0;
  } finally {
    await client.end().catch(() => undefined);
    await artifact.close();
    if (!complete) await unlink(destination);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const databaseUrl = process.env.ORDER_CODE_PREFLIGHT_DATABASE_URL;
  const outputPath = process.argv[2];
  if (!databaseUrl || !outputPath) {
    process.stderr.write('Usage: ORDER_CODE_PREFLIGHT_DATABASE_URL=<explicit URL> tsx scripts/order-code-preflight.ts /protected/output.json\n');
    process.exitCode = 1;
  } else {
    writeOrderCodePreflight(databaseUrl, outputPath).then(ready => {
      process.stdout.write(ready ? 'Protected inventory written; no duplicate or exhausted code counters found.\n' : 'Protected inventory written; operator resolution required before migration.\n');
      if (!ready) process.exitCode = 2;
    }).catch(() => {
      process.stderr.write('Preflight failed; check connection, permissions and output path. No complete artifact written.\n');
      process.exitCode = 1;
    });
  }
}
