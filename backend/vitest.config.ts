import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    // Database suites import production singletons and each own their disposable DB.
    fileParallelism: false,
    testTimeout: 10_000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL || 'postgresql://crmuser:password@127.0.0.1:5432/zalocrm_test?schema=public',
    },
  },
});
