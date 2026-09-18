/**
 * ai-provider-settings-service.ts — Secure storage and DTO translation for multi-tenant AI Provider configurations.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { config } from '../../config/index.js';
import { decodeSecureSetting, encodeSecureSetting } from '../../shared/settings/secure-setting-codec.js';
import { validateAiGatewayUrl } from './ai-gateway-validator.js';
import type {
  AiProviderConfig,
  AiProviderType,
  OrgAiProviderSettings,
} from './providers/ai-provider-interface.js';

const SETTING_KEY = 'ai_provider_config';

function maskKey(key?: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 3)}••••••••${key.slice(-4)}`;
}

/**
 * Returns host-level AI configuration from environment variables.
 */
export function getSystemDefaultAiSettings(): OrgAiProviderSettings {
  const primary = (config.aiPrimaryProvider as AiProviderType) || 'deepseek';
  const providers: Partial<Record<AiProviderType, AiProviderConfig>> = {};

  if (config.deepseekApiKey) {
    providers.deepseek = {
      type: 'deepseek',
      apiKey: config.deepseekApiKey,
      model: config.deepseekModel,
      supportsVision: true,
    };
  }
  if (config.geminiApiKey) {
    providers.gemini = {
      type: 'gemini',
      apiKey: config.geminiApiKey,
      model: config.geminiModel,
      supportsVision: true,
    };
  }
  if (config.openaiApiKey) {
    providers.openai = {
      type: 'openai',
      apiKey: config.openaiApiKey,
      model: config.openaiModel,
      supportsVision: true,
    };
  }

  const fallbackChain = (['deepseek', 'gemini', 'openai'] as AiProviderType[]).filter(
    (p) => p !== primary && Boolean(providers[p]),
  );

  return {
    primaryProvider: primary,
    providers,
    fallbackEnabled: fallbackChain.length > 0,
    fallbackChain,
    allowSystemFallback: true,
    monthlyBudgetVnd: 0,
    usdToVndRate: 25400,
  };
}

/**
 * Retrieves unmasked credentials for server-side report execution.
 */
export async function getOrgAiProviderCredentials(orgId: string): Promise<OrgAiProviderSettings> {
  const row = await prisma.appSetting.findUnique({
    where: { orgId_settingKey: { orgId, settingKey: SETTING_KEY } },
  });

  const rawJson = decodeSecureSetting(row);
  if (!rawJson) {
    return getSystemDefaultAiSettings();
  }

  try {
    const saved = JSON.parse(rawJson) as OrgAiProviderSettings;
    const system = getSystemDefaultAiSettings();

    // If tenant enabled allowSystemFallback (default true), merge system fallbacks for unconfigured keys
    const allowSystem = saved.allowSystemFallback ?? true;
    const mergedProviders: Partial<Record<AiProviderType, AiProviderConfig>> = { ...saved.providers };

    if (allowSystem) {
      for (const [type, sysCfg] of Object.entries(system.providers)) {
        if (!mergedProviders[type as AiProviderType]?.apiKey && sysCfg) {
          mergedProviders[type as AiProviderType] = sysCfg;
        }
      }
    }

    return {
      primaryProvider: saved.primaryProvider || system.primaryProvider,
      providers: mergedProviders,
      fallbackEnabled: saved.fallbackEnabled ?? system.fallbackEnabled,
      fallbackChain: saved.fallbackChain || system.fallbackChain,
      allowSystemFallback: allowSystem,
      monthlyBudgetVnd: saved.monthlyBudgetVnd !== undefined ? Number(saved.monthlyBudgetVnd) : 0,
      usdToVndRate: saved.usdToVndRate !== undefined ? Number(saved.usdToVndRate) : 25400,
    };
  } catch {
    return getSystemDefaultAiSettings();
  }
}

/**
 * Retrieves masked DTO safe to return to the frontend client.
 */
export async function getOrgAiProviderSettingsDto(orgId: string) {
  const row = await prisma.appSetting.findUnique({
    where: { orgId_settingKey: { orgId, settingKey: SETTING_KEY } },
  });

  const buildDefaultDto = () => {
    const system = getSystemDefaultAiSettings();
    const providersDto: Record<string, any> = {
      deepseek: { type: 'deepseek', model: config.deepseekModel, apiKey: '', apiKeySet: Boolean(config.deepseekApiKey), supportsVision: true },
      gemini: { type: 'gemini', model: config.geminiModel, apiKey: '', apiKeySet: Boolean(config.geminiApiKey), supportsVision: true },
      openai: { type: 'openai', model: config.openaiModel, apiKey: '', apiKeySet: Boolean(config.openaiApiKey), supportsVision: true },
      custom: { type: 'custom', model: 'llama-3.3-70b', apiKey: '', apiKeySet: false, baseUrl: '', supportsVision: false },
    };

    return {
      isSystemDefault: true,
      primaryProvider: system.primaryProvider,
      fallbackEnabled: system.fallbackEnabled,
      fallbackChain: system.fallbackChain,
      allowSystemFallback: true,
      monthlyBudgetVnd: 0,
      usdToVndRate: 25400,
      providers: providersDto,
    };
  };

  const rawJson = decodeSecureSetting(row);
  if (!rawJson) {
    return buildDefaultDto();
  }

  try {
    const saved = JSON.parse(rawJson);
    const providersDto: Record<string, any> = {};

    for (const type of ['deepseek', 'gemini', 'openai', 'custom']) {
      const cfg = saved.providers?.[type] || {};
      providersDto[type] = {
        type,
        model: cfg.model || (type === 'gemini' ? config.geminiModel : type === 'deepseek' ? config.deepseekModel : type === 'openai' ? config.openaiModel : (type === 'custom' ? 'llama-3.3-70b' : '')),
        apiKey: maskKey(cfg.apiKey),
        apiKeySet: Boolean(cfg.apiKey),
        baseUrl: cfg.baseUrl || '',
        supportsVision:
          type === 'deepseek'
            ? Boolean(cfg.supportsVision) || /flash|vl|vision/i.test(cfg.model || config.deepseekModel)
            : (cfg.supportsVision ?? (type === 'gemini' || type === 'openai')),
      };
    }

    return {
      isSystemDefault: false,
      primaryProvider: saved.primaryProvider || config.aiPrimaryProvider || 'deepseek',
      fallbackEnabled: saved.fallbackEnabled ?? true,
      fallbackChain: saved.fallbackChain || [],
      allowSystemFallback: saved.allowSystemFallback ?? true,
      monthlyBudgetVnd: saved.monthlyBudgetVnd !== undefined ? Number(saved.monthlyBudgetVnd) : 0,
      usdToVndRate: saved.usdToVndRate !== undefined ? Number(saved.usdToVndRate) : 25400,
      providers: providersDto,
    };
  } catch {
    return buildDefaultDto();
  }
}

/**
 * Persists organization AI settings encrypted in AppSetting.
 */
export async function saveOrgAiProviderSettings(orgId: string, payload: any): Promise<void> {
  const existingRow = await prisma.appSetting.findUnique({
    where: { orgId_settingKey: { orgId, settingKey: SETTING_KEY } },
  });

  let existingData: any = {};
  if (existingRow) {
    const raw = decodeSecureSetting(existingRow);
    if (raw) {
      try { existingData = JSON.parse(raw); } catch { /* ignore */ }
    }
  }

  const updatedProviders: Record<string, any> = { ...(existingData.providers || {}) };
  if (payload.providers && typeof payload.providers === 'object') {
    for (const [type, incoming] of Object.entries(payload.providers)) {
      if (!incoming || typeof incoming !== 'object') continue;
      const inc = incoming as any;
      const prev = existingData.providers?.[type] || {};

      let apiKey = inc.apiKey?.trim();
      const isMaskedOrEmpty = !apiKey || apiKey.includes('••••');
      if (isMaskedOrEmpty) {
        apiKey = prev.apiKey || '';
      }

      const baseUrl = inc.baseUrl !== undefined ? (inc.baseUrl ? String(inc.baseUrl).trim() : '') : prev.baseUrl;
      if (baseUrl) {
        if (isMaskedOrEmpty && prev.apiKey && baseUrl !== prev.baseUrl) {
          throw new Error('Không thể thay đổi Base URL khi đang sử dụng API Key đã lưu');
        }
        await validateAiGatewayUrl(baseUrl);
      }

      updatedProviders[type] = {
        type: inc.type || type,
        model: inc.model || prev.model || '',
        apiKey,
        baseUrl,
        supportsVision: inc.supportsVision !== undefined ? inc.supportsVision : prev.supportsVision,
      };
    }
  }

  const toSave = {
    primaryProvider: payload.primaryProvider || existingData.primaryProvider || config.aiPrimaryProvider || 'deepseek',
    fallbackEnabled: payload.fallbackEnabled ?? existingData.fallbackEnabled ?? true,
    fallbackChain: payload.fallbackChain || existingData.fallbackChain || [],
    allowSystemFallback: payload.allowSystemFallback ?? existingData.allowSystemFallback ?? true,
    monthlyBudgetVnd: payload.monthlyBudgetVnd !== undefined ? Number(payload.monthlyBudgetVnd) : (existingData.monthlyBudgetVnd !== undefined ? Number(existingData.monthlyBudgetVnd) : 0),
    usdToVndRate: payload.usdToVndRate !== undefined ? Number(payload.usdToVndRate) : (existingData.usdToVndRate !== undefined ? Number(existingData.usdToVndRate) : 25400),
    providers: updatedProviders,
  };

  const encoded = encodeSecureSetting(JSON.stringify(toSave));

  await prisma.appSetting.upsert({
    where: { orgId_settingKey: { orgId, settingKey: SETTING_KEY } },
    create: {
      orgId,
      settingKey: SETTING_KEY,
      ...encoded,
    },
    update: {
      ...encoded,
    },
  });
}
