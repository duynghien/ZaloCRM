import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const migrations = new URL('../prisma/migrations/', import.meta.url);
const required = [];
for (const entry of (await readdir(migrations, { withFileTypes: true })).filter(entry => entry.isDirectory()).sort((a,b) => a.name.localeCompare(b.name))) {
  const sql = await readFile(new URL(`${entry.name}/migration.sql`, migrations));
  required.push({ name: entry.name, checksum: createHash('sha256').update(sql).digest('hex') });
}
await writeFile(new URL('../src/shared/database/required-migrations.json', import.meta.url), `${JSON.stringify(required, null, 2)}\n`);
