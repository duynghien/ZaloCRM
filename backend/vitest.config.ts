import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    // Database suites import production singletons and each own their disposable DB.
    fileParallelism: false,
    testTimeout: 10_000,
  },
});
