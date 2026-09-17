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
const aiPrimaryProvider = process.env.AI_PRIMARY_PROVIDER || 'gemini';
const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

if (aiPrimaryProvider === 'gemini' && (!/^gemini-(?:2\.5|3\.)[a-z0-9.-]+$/i.test(geminiModel) || geminiModel.startsWith('gemini-2.0-'))) {
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

import fs from 'node:fs';
import path from 'node:path';

function resolveUploadDir(): string {
  const preferred = process.env.UPLOAD_DIR || '/var/lib/zalo-crm/files';
  try {
    fs.mkdirSync(preferred, { recursive: true });
    const probe = path.join(preferred, `.probe-${Date.now()}`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return preferred;
  } catch {
    const fallback = path.resolve(process.cwd(), 'uploads');
    try {
      fs.mkdirSync(fallback, { recursive: true });
    } catch {}
    return fallback;
  }
}

export const config = {
  port: parseInt(process.env.PORT || '3000'),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv,
  jwtSecret,
  encryptionKey,
  databaseUrl: process.env.DATABASE_URL || 'postgresql://crmuser:password@localhost:5432/zalocrm',
  uploadDir: resolveUploadDir(),
  appUrl,
  appOrigin,
  accessTokenTtl: '15m',
  refreshSessionTtlMs: Math.max(1, Number.isFinite(refreshSessionDays) ? refreshSessionDays : 7) * 24 * 60 * 60 * 1000,
  refreshCookieName: 'zalo_crm_refresh',
  csrfCookieName: 'zalo_crm_csrf',
  mediaCookieName: 'zalo_crm_media_session',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel,
  aiPrimaryProvider,
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  allowPrivateAiGateways: process.env.ALLOW_PRIVATE_AI_GATEWAYS === 'true',
  aiReportMaxMessages: Math.max(1, Number.isFinite(aiReportMaxMessages) ? aiReportMaxMessages : 10_000),
  aiReportMaxTokens: Math.max(1, Number.isFinite(aiReportMaxTokens) ? aiReportMaxTokens : 200_000),
  isProduction,
};
