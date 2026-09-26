/**
 * migrate-message-index-concurrently.ts
 * Executes CREATE INDEX CONCURRENTLY for messages(conversation_id, sent_at DESC) outside a transaction block.
 * Safe for production zero-downtime deployment on large active tables.
 */
import { Client } from 'pg';
import { logger } from '../src/shared/utils/logger.js';

export async function runConcurrentMessageIndex(databaseUrl?: string): Promise<void> {
  const connStr = databaseUrl || process.env.DATABASE_URL;
  if (!connStr) {
    throw new Error('DATABASE_URL is required to run concurrent index migration');
  }

  const client = new Client({ connectionString: connStr });
  await client.connect();

  try {
    logger.info('[migration] Creating composite index messages_conversation_id_sent_at_idx CONCURRENTLY...');
    // In PostgreSQL, CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
    await client.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS messages_conversation_id_sent_at_idx
      ON messages (conversation_id, sent_at DESC);
    `);
    logger.info('[migration] Successfully ensured messages_conversation_id_sent_at_idx created CONCURRENTLY.');
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith('migrate-message-index-concurrently.ts')) {
  runConcurrentMessageIndex()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Failed to create message index concurrently:', err);
      process.exit(1);
    });
}
