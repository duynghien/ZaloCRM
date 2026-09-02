/**
 * Centralized configuration loader.
 * All environment variables are read once at startup and typed here.
 * In production mode, validates that strong secret keys are configured.
 */
const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

const jwtSecret = process.env.JWT_SECRET || 'dev-secret-change-me';
const encryptionKey = process.env.ENCRYPTION_KEY || 'dev-key-change-me-16b';
const appUrl = process.env.APP_URL || 'http://localhost:3000';
const appOrigin = new URL(appUrl).origin;
const refreshSessionDays = Number.parseInt(process.env.REFRESH_SESSION_DAYS || '7', 10);
const aiReportMaxMessages = Number.parseInt(process.env.AI_REPORT_MAX_MESSAGES || '10000', 10);
const aiReportMaxTokens = Number.parseInt(process.env.AI_REPORT_MAX_TOKENS || '200000', 10);
const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

if (!/^gemini-(?:2\.5|3\.)[a-z0-9.-]+$/i.test(geminiModel) || geminiModel.startsWith('gemini-2.0-')) {
  throw new Error(`GEMINI_MODEL must name a supported Gemini 2.5+ stable model; received ${geminiModel}.`);
}

// Validate production secrets
if (isProduction) {
  const isDefaultJwt = !process.env.JWT_SECRET || jwtSecret === 'dev-secret-change-me';
  const isDefaultEncryption = !process.env.ENCRYPTION_KEY || encryptionKey === 'dev-key-change-me-16b';

  if (isDefaultJwt || isDefaultEncryption) {
    const errorMsg =
      `[FATAL SECURITY ERROR] Insecure configuration in production mode!\n` +
      `You MUST set custom strong values for JWT_SECRET and ENCRYPTION_KEY in your .env file before running in production.\n` +
      `Generate strong keys using: openssl rand -hex 32`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
}

export const config = {
  port: parseInt(process.env.PORT || '3000'),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv,
  jwtSecret,
  encryptionKey,
  databaseUrl: process.env.DATABASE_URL || 'postgresql://crmuser:password@localhost:5432/zalocrm',
  uploadDir: process.env.UPLOAD_DIR || '/var/lib/zalo-crm/files',
  appUrl,
  appOrigin,
  accessTokenTtl: '15m',
  refreshSessionTtlMs: Math.max(1, Number.isFinite(refreshSessionDays) ? refreshSessionDays : 7) * 24 * 60 * 60 * 1000,
  refreshCookieName: 'zalo_crm_refresh',
  csrfCookieName: 'zalo_crm_csrf',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel,
  aiReportMaxMessages: Math.max(1, Number.isFinite(aiReportMaxMessages) ? aiReportMaxMessages : 10_000),
  aiReportMaxTokens: Math.max(1, Number.isFinite(aiReportMaxTokens) ? aiReportMaxTokens : 200_000),
  isProduction,
};
