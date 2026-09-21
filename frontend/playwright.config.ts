import { defineConfig } from '@playwright/test';
import realtimeFixture from './playwright-phase1.config';

// Every default browser test runs against the owned full-stack fixture.
export default defineConfig({
  ...realtimeFixture,
  testMatch: [
    'auth-session-smoke.spec.ts',
    'zalo-qr-session.spec.ts',
    'chat-recovery.spec.ts',
    'ai-report-account-targets.spec.ts',
    'auth-session-lifecycle.spec.ts',
    'member-account-permissions.spec.ts',
    'api-settings-permissions.spec.ts',
    'kiotviet-order-sync.spec.ts',
  ],
});
