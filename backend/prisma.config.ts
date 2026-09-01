import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Generation is database-free; migration commands still fail closed unless
    // the deployment environment supplies a real DATABASE_URL.
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/prisma_generation',
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
