import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['zalo-qr-session.spec.ts', 'chat-recovery.spec.ts'],
  workers: 1,
  timeout: 30_000,
  use: { ignoreHTTPSErrors: true, channel: 'chromium', baseURL: 'https://127.0.0.1:4183', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run build && cd ../backend && npx tsx tests/helpers/phase1-browser-server.ts',
    url: 'https://127.0.0.1:4183/health',
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 180_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },
  },
});
