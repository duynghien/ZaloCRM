/**
 * legacy-migration-service.ts — Runtime idempotent data migration for API keys and webhooks.
 * Runs under pg_advisory_xact_lock to migrate legacy app_settings rows to api_keys and webhook_subscriptions.
 */
import crypto from 'node:crypto';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { config } from '../../../config/index.js';
import { encryptData } from '../../../shared/utils/crypto.js';
import { decodeSecureSetting } from '../../../shared/settings/secure-setting-codec.js';

export async function runLegacyApiAndWebhookMigration(): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      // 1. Acquire transaction-level advisory lock to serialize multi-instance execution
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('zalo_crm_legacy_gateway_migration'))`;

      // ── Migrate Legacy API Keys ───────────────────────────────────────────
      const legacyKeySettings = await tx.appSetting.findMany({
        where: {
          settingKey: { in: ['public_api_key', 'public_api_key_hash', 'public_api_key_prefix'] },
        },
      });

      // Group settings by orgId
      const orgKeysMap = new Map<string, { plaintext?: string; hash?: string; prefix?: string }>();
      for (const row of legacyKeySettings) {
        const current = orgKeysMap.get(row.orgId) || {};
        if (row.settingKey === 'public_api_key' && row.valuePlain) {
          current.plaintext = row.valuePlain;
        } else if (row.settingKey === 'public_api_key_hash' && row.valuePlain) {
          current.hash = row.valuePlain;
        } else if (row.settingKey === 'public_api_key_prefix' && row.valuePlain) {
          current.prefix = row.valuePlain;
        }
        orgKeysMap.set(row.orgId, current);
      }

      for (const [orgId, entry] of orgKeysMap.entries()) {
        let keyHash = entry.hash;
        let prefix = entry.prefix;

        if (!keyHash && entry.plaintext) {
          keyHash = crypto.createHash('sha256').update(entry.plaintext).digest('hex');
          prefix = prefix || entry.plaintext.slice(0, 10);
        }

        if (keyHash) {
          prefix = prefix || 'zcrm_';
          const existingKey = await tx.apiKey.findUnique({
            where: { keyHash },
          });

          if (!existingKey) {
            await tx.apiKey.create({
              data: {
                orgId,
                name: 'Default API Key',
                keyPrefix: prefix,
                keyHash,
                scopes: ['*'],
                rateLimit: 60,
                isActive: true,
              },
            });
            logger.info(`[migration] Migrated legacy API key for org ${orgId}`);
          }

          // Delete legacy settings in the same transaction
          await tx.appSetting.deleteMany({
            where: {
              orgId,
              settingKey: { in: ['public_api_key', 'public_api_key_hash', 'public_api_key_prefix'] },
            },
          });
        }
      }

      // ── Migrate Legacy Webhooks ───────────────────────────────────────────
      const legacyWebhookSettings = await tx.appSetting.findMany({
        where: {
          settingKey: { in: ['webhook_url', 'webhook_secret'] },
        },
      });

      const orgWebhookMap = new Map<string, { url?: string; secretSetting?: any }>();
      for (const row of legacyWebhookSettings) {
        const current = orgWebhookMap.get(row.orgId) || {};
        if (row.settingKey === 'webhook_url' && row.valuePlain) {
          current.url = row.valuePlain;
        } else if (row.settingKey === 'webhook_secret') {
          current.secretSetting = row;
        }
        orgWebhookMap.set(row.orgId, current);
      }

      for (const [orgId, entry] of orgWebhookMap.entries()) {
        const targetUrl = entry.url?.trim();
        if (targetUrl) {
          const secret = decodeSecureSetting(entry.secretSetting);
          const secretEncrypted = secret
            ? Buffer.from(encryptData(secret, config.encryptionKey), 'utf8')
            : null;

          // Check if subscription already exists
          let sub = await tx.webhookSubscription.findFirst({
            where: { orgId, deletedAt: null },
          });

          if (!sub) {
            sub = await tx.webhookSubscription.create({
              data: {
                orgId,
                name: 'Default Webhook',
                targetUrl,
                secretEncrypted,
                events: ['*'],
                isActive: true,
              },
            });
            logger.info(`[migration] Migrated legacy webhook subscription for org ${orgId}`);
          }

          // Backfill snapshot on true legacy pending rows
          await tx.webhookOutbox.updateMany({
            where: {
              orgId,
              subscriptionId: null,
              destinationUrl: null,
              status: 'pending',
            },
            data: {
              subscriptionId: sub.id,
              destinationUrl: targetUrl,
              signingSecretEncrypted: secretEncrypted,
              sendV1SignatureSnapshot: true,
            },
          });

          // Delete legacy settings in the same transaction
          await tx.appSetting.deleteMany({
            where: {
              orgId,
              settingKey: { in: ['webhook_url', 'webhook_secret'] },
            },
          });
        }
      }
    });

    logger.info('[migration] Legacy API key and webhook migration completed successfully');
  } catch (error) {
    logger.error('[migration] Failed to execute legacy API key & webhook migration:', error);
    throw error;
  }
}
