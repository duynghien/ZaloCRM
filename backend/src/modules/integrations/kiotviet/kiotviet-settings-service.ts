/**
 * KiotViet Settings Service
 *
 * Manages KiotViet configuration, credentials encryption/decryption,
 * revision fences, and public DTO projection.
 *
 * Invariant: Bypasses in-memory cache of app-setting-service for execution config
 * to guarantee multi-process / clustered synchronization.
 */

import { prisma } from '../../../shared/database/prisma-client.js';
import { encodeSecureSetting, decodeSecureSetting } from '../../../shared/settings/secure-setting-codec.js';
import { invalidateAppSetting } from '../../../shared/settings/app-setting-service.js';
import { RequestValidationError } from '../../../shared/http/request-schemas.js';
import type {
  KiotvietConfig,
  KiotvietConfigInput,
  KiotvietPublicConfigDto,
} from './kiotviet-types.js';

export const KIOTVIET_SETTING_KEYS = {
  CLIENT_ID: 'kiotviet_client_id',
  CLIENT_SECRET: 'kiotviet_client_secret',
  RETAILER: 'kiotviet_retailer',
  BRANCH_ID: 'kiotviet_branch_id',
  AUTO_SYNC: 'kiotviet_auto_sync',
  SOLD_BY_ID: 'kiotviet_sold_by_id',
  PAYMENT_ACCOUNT_ID: 'kiotviet_payment_account_id',
} as const;

export class KiotvietConflictError extends Error {
  readonly statusCode = 409;
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    Object.setPrototypeOf(this, KiotvietConflictError.prototype);
  }
}

type PrismaClientOrTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0] | typeof prisma;

/**
 * Validates and normalizes configuration input.
 */
function normalizeConfigInput(input: KiotvietConfigInput): KiotvietConfigInput {
  const normalized: KiotvietConfigInput = {};

  if (input.clientId !== undefined) {
    if (typeof input.clientId !== 'string' || input.clientId.length > 255) {
      throw new RequestValidationError('Invalid clientId');
    }
    normalized.clientId = input.clientId.trim();
  }

  if (input.clientSecret !== undefined && input.clientSecret !== null) {
    if (typeof input.clientSecret !== 'string' || input.clientSecret.length > 255) {
      throw new RequestValidationError('Invalid clientSecret');
    }
    // Reject mask placeholders like '******' or '••••••'
    if (/^[*•]+$/.test(input.clientSecret.trim())) {
      throw new RequestValidationError('Masked secret placeholder is not accepted as new secret');
    }
    normalized.clientSecret = input.clientSecret;
  }

  if (input.retailer !== undefined) {
    if (typeof input.retailer !== 'string' || input.retailer.length > 100) {
      throw new RequestValidationError('Invalid retailer');
    }
    normalized.retailer = input.retailer.trim();
  }

  if (input.branchId !== undefined) {
    if (typeof input.branchId !== 'string' || input.branchId.length > 64) {
      throw new RequestValidationError('Invalid branchId');
    }
    normalized.branchId = input.branchId.trim();
  }

  if (input.autoSync !== undefined) {
    if (typeof input.autoSync !== 'boolean') {
      throw new RequestValidationError('Invalid autoSync');
    }
    normalized.autoSync = input.autoSync;
  }

  if (input.soldById !== undefined) {
    if (input.soldById !== null && (typeof input.soldById !== 'string' || input.soldById.length > 64)) {
      throw new RequestValidationError('Invalid soldById');
    }
    normalized.soldById = input.soldById ? input.soldById.trim() : null;
  }

  if (input.paymentAccountId !== undefined) {
    if (input.paymentAccountId !== null && (typeof input.paymentAccountId !== 'string' || input.paymentAccountId.length > 64)) {
      throw new RequestValidationError('Invalid paymentAccountId');
    }
    normalized.paymentAccountId = input.paymentAccountId ? input.paymentAccountId.trim() : null;
  }

  if (input.clearSecret !== undefined) {
    if (typeof input.clearSecret !== 'boolean') {
      throw new RequestValidationError('Invalid clearSecret');
    }
    normalized.clearSecret = input.clearSecret;
  }

  return normalized;
}

/**
 * Reads the execution configuration directly from the database (bypassing in-memory LRU cache)
 * to ensure multi-process consistency.
 */
export async function getKiotvietConfig(
  orgId: string,
  db: PrismaClientOrTx = prisma
): Promise<KiotvietConfig | null> {
  const [settings, syncState] = await Promise.all([
    db.appSetting.findMany({
      where: {
        orgId,
        settingKey: { in: Object.values(KIOTVIET_SETTING_KEYS) },
      },
    }),
    db.kiotvietSyncState.findUnique({
      where: { orgId },
    }),
  ]);

  const map = new Map(settings.map(s => [s.settingKey, s]));
  const secretRow = map.get(KIOTVIET_SETTING_KEYS.CLIENT_SECRET);
  const decryptedSecret = decodeSecureSetting(secretRow);

  const clientId = map.get(KIOTVIET_SETTING_KEYS.CLIENT_ID)?.valuePlain ?? '';
  const retailer = syncState?.retailer ?? map.get(KIOTVIET_SETTING_KEYS.RETAILER)?.valuePlain ?? '';
  const branchId = syncState?.branchId?.toString() ?? map.get(KIOTVIET_SETTING_KEYS.BRANCH_ID)?.valuePlain ?? '';
  const autoSync = map.get(KIOTVIET_SETTING_KEYS.AUTO_SYNC)?.valuePlain === 'true';
  const soldById = map.get(KIOTVIET_SETTING_KEYS.SOLD_BY_ID)?.valuePlain ?? null;
  const paymentAccountId = map.get(KIOTVIET_SETTING_KEYS.PAYMENT_ACCOUNT_ID)?.valuePlain ?? null;
  const configRevision = syncState?.configRevision ?? 0;

  if (!clientId && !decryptedSecret && !retailer) {
    return null;
  }

  return {
    clientId,
    clientSecret: decryptedSecret ?? '',
    retailer,
    branchId,
    autoSync,
    soldById,
    paymentAccountId,
    configRevision,
  };
}

/**
 * Returns the public sanitized configuration DTO for an organization.
 * Never exposes the client secret or raw encrypted bytes.
 */
export async function getKiotvietPublicConfig(
  orgId: string,
  db: PrismaClientOrTx = prisma
): Promise<KiotvietPublicConfigDto> {
  const [settings, syncState] = await Promise.all([
    db.appSetting.findMany({
      where: {
        orgId,
        settingKey: { in: Object.values(KIOTVIET_SETTING_KEYS) },
      },
    }),
    db.kiotvietSyncState.findUnique({
      where: { orgId },
    }),
  ]);

  const map = new Map(settings.map(s => [s.settingKey, s]));
  const secretRow = map.get(KIOTVIET_SETTING_KEYS.CLIENT_SECRET);
  const secretConfigured = Boolean(secretRow?.valueEncrypted || secretRow?.valuePlain);

  const clientId = map.get(KIOTVIET_SETTING_KEYS.CLIENT_ID)?.valuePlain ?? '';
  const retailer = syncState?.retailer ?? map.get(KIOTVIET_SETTING_KEYS.RETAILER)?.valuePlain ?? '';
  const branchId = syncState?.branchId?.toString() ?? map.get(KIOTVIET_SETTING_KEYS.BRANCH_ID)?.valuePlain ?? '';
  const autoSync = map.get(KIOTVIET_SETTING_KEYS.AUTO_SYNC)?.valuePlain === 'true';
  const soldById = map.get(KIOTVIET_SETTING_KEYS.SOLD_BY_ID)?.valuePlain ?? null;
  const paymentAccountId = map.get(KIOTVIET_SETTING_KEYS.PAYMENT_ACCOUNT_ID)?.valuePlain ?? null;
  const configRevision = syncState?.configRevision ?? 0;
  const catalogReady = syncState?.catalogReady ?? false;
  const lastSuccessfulSyncAt = syncState?.lastSuccessfulAt ? syncState.lastSuccessfulAt.toISOString() : null;

  return {
    clientId,
    retailer,
    branchId,
    autoSync,
    soldById,
    paymentAccountId,
    secretConfigured,
    configRevision,
    catalogReady,
    lastSuccessfulSyncAt,
  };
}

/**
 * Saves KiotViet configuration transactionally with revision checking and active dispatch fencing.
 */
export async function saveKiotvietConfig(
  orgId: string,
  rawInput: KiotvietConfigInput,
  expectedRevision?: number
): Promise<KiotvietPublicConfigDto> {
  const input = normalizeConfigInput(rawInput);

  return await prisma.$transaction(async (tx) => {
    // 1. Guard against mutations during active dispatch or uncertain reconciliation
    const activeJobsCount = await tx.kiotvietInvoiceJob.count({
      where: {
        orgId,
        state: { in: ['dispatching', 'uncertain'] },
      },
    });

    if (activeJobsCount > 0) {
      throw new KiotvietConflictError(
        'Cannot modify KiotViet configuration while an invoice dispatch or uncertain reconciliation is active',
        'invoice_in_flight'
      );
    }

    // 2. Fetch current sync state and verify revision fence
    const currentState = await tx.kiotvietSyncState.findUnique({
      where: { orgId },
    });

    const currentRevision = currentState?.configRevision ?? 0;
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      throw new KiotvietConflictError(
        `Configuration revision conflict: expected revision ${expectedRevision}, but current revision is ${currentRevision}`,
        'config_changed'
      );
    }

    // 3. Fetch existing settings directly from DB
    const existingSettings = await tx.appSetting.findMany({
      where: {
        orgId,
        settingKey: { in: Object.values(KIOTVIET_SETTING_KEYS) },
      },
    });
    const settingsMap = new Map(existingSettings.map(s => [s.settingKey, s]));

    // 4. Determine secret handling (omission preserves, clearSecret resets, new secret encrypts)
    let secretData: { valuePlain: string | null; valueEncrypted: Uint8Array<ArrayBuffer> | null } | undefined;
    if (input.clearSecret) {
      secretData = { valuePlain: null, valueEncrypted: null };
    } else if (input.clientSecret) {
      secretData = encodeSecureSetting(input.clientSecret);
    }

    // 5. Determine retailer and branch changes
    const currentRetailer = currentState?.retailer ?? settingsMap.get(KIOTVIET_SETTING_KEYS.RETAILER)?.valuePlain ?? '';
    const currentBranchId = currentState?.branchId?.toString() ?? settingsMap.get(KIOTVIET_SETTING_KEYS.BRANCH_ID)?.valuePlain ?? '';

    const newRetailer = input.retailer !== undefined ? input.retailer : currentRetailer;
    const newBranchId = input.branchId !== undefined ? input.branchId : currentBranchId;

    const retailerChanged = input.retailer !== undefined && input.retailer !== currentRetailer;
    const branchChanged = input.branchId !== undefined && input.branchId !== currentBranchId;
    const shouldResetCatalog = retailerChanged || branchChanged;

    const nextRevision = currentRevision + 1;

    // 6. Fail any queued/preparing jobs under old revision so they do not dispatch with obsolete credentials/partition
    await tx.kiotvietInvoiceJob.updateMany({
      where: {
        orgId,
        state: { in: ['queued', 'preparing'] },
      },
      data: {
        state: 'failed',
        errorCode: 'config_changed',
        errorMessage: 'Configuration revision changed before invoice dispatch; please review and re-confirm order',
      },
    });

    // 7. Upsert settings in DB
    const upsertSetting = async (key: string, plainValue: string | null, encryptedValue?: Uint8Array<ArrayBuffer> | null) => {
      await tx.appSetting.upsert({
        where: { orgId_settingKey: { orgId, settingKey: key } },
        create: {
          orgId,
          settingKey: key,
          valuePlain: plainValue,
          valueEncrypted: encryptedValue ?? null,
        },
        update: {
          valuePlain: plainValue,
          valueEncrypted: encryptedValue !== undefined ? encryptedValue : undefined,
        },
      });
    };

    if (input.clientId !== undefined) {
      await upsertSetting(KIOTVIET_SETTING_KEYS.CLIENT_ID, input.clientId);
    }
    if (secretData !== undefined) {
      await upsertSetting(KIOTVIET_SETTING_KEYS.CLIENT_SECRET, secretData.valuePlain, secretData.valueEncrypted);
    }
    if (input.retailer !== undefined) {
      await upsertSetting(KIOTVIET_SETTING_KEYS.RETAILER, input.retailer);
    }
    if (input.branchId !== undefined) {
      await upsertSetting(KIOTVIET_SETTING_KEYS.BRANCH_ID, input.branchId);
    }
    if (input.autoSync !== undefined) {
      await upsertSetting(KIOTVIET_SETTING_KEYS.AUTO_SYNC, input.autoSync ? 'true' : 'false');
    }
    if (input.soldById !== undefined) {
      await upsertSetting(KIOTVIET_SETTING_KEYS.SOLD_BY_ID, input.soldById);
    }
    if (input.paymentAccountId !== undefined) {
      await upsertSetting(KIOTVIET_SETTING_KEYS.PAYMENT_ACCOUNT_ID, input.paymentAccountId);
    }

    // 8. Update KiotvietSyncState
    const parsedBranchId = newBranchId && /^\d+$/.test(newBranchId) ? BigInt(newBranchId) : null;
    await tx.kiotvietSyncState.upsert({
      where: { orgId },
      create: {
        orgId,
        configRevision: nextRevision,
        retailer: newRetailer || null,
        branchId: parsedBranchId,
        catalogReady: false,
        catalogCursor: null,
      },
      update: {
        configRevision: nextRevision,
        retailer: newRetailer || null,
        branchId: parsedBranchId,
        ...(shouldResetCatalog ? { catalogReady: false, catalogCursor: null } : {}),
      },
    });

    // 9. Invalidate in-memory caches
    for (const key of Object.values(KIOTVIET_SETTING_KEYS)) {
      invalidateAppSetting(orgId, key);
    }

    return await getKiotvietPublicConfig(orgId, tx);
  });
}
