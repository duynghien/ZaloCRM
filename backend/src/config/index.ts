/**
 * Centralized configuration loader.
 * All environment variables are read once at startup and typed here.
 * In production mode, validates that strong secret keys are configured.
 */
const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

const jwtSecret = process.env.JWT_SECRET || 'dev-secret-change-me';
const encryptionKey = process.env.ENCRYPTION_KEY || 'dev-key-change-me-16b';

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
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  isProduction,
};
