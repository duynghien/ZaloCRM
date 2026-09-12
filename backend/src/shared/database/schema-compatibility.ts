import required from './required-migrations.json' with { type: 'json' };
import { prisma } from './prisma-client.js';
/** Built migration checksums prevent a stale migrator success from advertising readiness. */
export async function schemaIsCompatible(): Promise<boolean> {
  const applied = await prisma.$queryRaw<Array<{ migration_name: string; checksum: string }>>`SELECT migration_name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  return required.every(expected => applied.some(row => row.migration_name === expected.name && row.checksum === expected.checksum));
}
