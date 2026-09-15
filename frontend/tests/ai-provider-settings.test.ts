import { describe, expect, it } from 'vitest';
import {
  ALL_AI_PROVIDERS,
  DEFAULT_AI_PROVIDERS,
  MODEL_SUGGESTIONS,
  computeFallbackChain,
  createDefaultAiProviderSettings,
} from '../src/api/ai-report-view-helpers';

describe('AI Provider Settings Helpers', () => {
  it('creates complete default settings with all 4 providers', () => {
    const defaults = createDefaultAiProviderSettings();

    expect(defaults.primaryProvider).toBe('gemini');
    expect(defaults.isSystemDefault).toBe(true);
    expect(defaults.fallbackEnabled).toBe(true);
    expect(defaults.allowSystemFallback).toBe(true);
    expect(defaults.fallbackChain).toEqual(['deepseek', 'openai']);

    for (const provider of ALL_AI_PROVIDERS) {
      expect(defaults.providers[provider]).toBeDefined();
      expect(defaults.providers[provider].type).toBe(provider);
      expect(defaults.providers[provider].model).toBeTruthy();
      expect(defaults.providers[provider].apiKey).toBe('');
    }
  });

  it('computes fallback chain correctly excluding the primary provider', () => {
    const chainForGemini = computeFallbackChain('gemini');
    expect(chainForGemini).not.toContain('gemini');
    expect(chainForGemini).toEqual(['deepseek', 'openai', 'custom']);

    const chainForDeepseek = computeFallbackChain('deepseek');
    expect(chainForDeepseek).not.toContain('deepseek');
    expect(chainForDeepseek).toEqual(['gemini', 'openai', 'custom']);

    const chainForOpenai = computeFallbackChain('openai');
    expect(chainForOpenai).not.toContain('openai');
    expect(chainForOpenai).toEqual(['gemini', 'deepseek', 'custom']);

    const chainForCustom = computeFallbackChain('custom');
    expect(chainForCustom).not.toContain('custom');
    expect(chainForCustom).toEqual(['gemini', 'deepseek', 'openai']);
  });

  it('has model suggestions for all providers', () => {
    for (const provider of ALL_AI_PROVIDERS) {
      expect(MODEL_SUGGESTIONS[provider]).toBeDefined();
      expect(Array.isArray(MODEL_SUGGESTIONS[provider])).toBe(true);
      expect(MODEL_SUGGESTIONS[provider].length).toBeGreaterThan(0);
    }
  });

  it('merges partial server providers with defaults without mutating defaults', () => {
    const serverPayload = {
      isSystemDefault: false,
      primaryProvider: 'deepseek' as const,
      fallbackEnabled: true,
      fallbackChain: ['gemini'],
      allowSystemFallback: true,
      providers: {
        deepseek: {
          type: 'deepseek' as const,
          model: 'deepseek-reasoner',
          apiKey: '••••••••',
          apiKeySet: true,
        },
      },
    };

    const merged = {
      ...serverPayload,
      providers: {
        ...DEFAULT_AI_PROVIDERS,
        ...(serverPayload.providers || {}),
      },
    };

    expect(merged.providers.deepseek.model).toBe('deepseek-reasoner');
    expect(merged.providers.gemini.model).toBe('gemini-2.5-flash');
    expect(merged.providers.openai.model).toBe('gpt-4o-mini');
    expect(merged.providers.custom.model).toBe('llama-3.3-70b');
    expect(DEFAULT_AI_PROVIDERS.deepseek.model).toBe('deepseek-chat');
  });

  describe('Primary Provider Auto-Switch and 1-Click Logic', () => {
    it('detects when current primary provider has no key configured', () => {
      const settings = createDefaultAiProviderSettings(); // primary is gemini with empty key
      const currentPrimaryConfig = settings.providers[settings.primaryProvider];
      const isCurrentPrimaryUnset = !currentPrimaryConfig.apiKey && !currentPrimaryConfig.apiKeySet;
      expect(isCurrentPrimaryUnset).toBe(true);
    });

    it('detects when current primary provider already has a key configured or masked', () => {
      const settings = createDefaultAiProviderSettings();
      settings.providers.gemini.apiKeySet = true;
      const currentPrimaryConfig = settings.providers[settings.primaryProvider];
      const isCurrentPrimaryUnset = !currentPrimaryConfig.apiKey && !currentPrimaryConfig.apiKeySet;
      expect(isCurrentPrimaryUnset).toBe(false);
    });

    it('enables 1-click set as primary when another provider has an apiKey or apiKeySet', () => {
      const settings = createDefaultAiProviderSettings();
      settings.primaryProvider = 'gemini';
      settings.providers.gemini.apiKeySet = true;

      // Deepseek has an API key entered
      settings.providers.deepseek.apiKey = 'sk-deepseek-123456';

      const selectedTab = 'deepseek';
      const canSetAsPrimary =
        selectedTab !== settings.primaryProvider &&
        Boolean(settings.providers[selectedTab].apiKey || settings.providers[selectedTab].apiKeySet);

      expect(canSetAsPrimary).toBe(true);
    });

    it('auto-switches primary provider if primary is unset when user types new key on another provider', () => {
      const settings = createDefaultAiProviderSettings();
      expect(settings.primaryProvider).toBe('gemini');

      // Primary (gemini) is unset
      const isCurrentPrimaryUnset = !settings.providers.gemini.apiKey && !settings.providers.gemini.apiKeySet;
      expect(isCurrentPrimaryUnset).toBe(true);

      const selectedTab = 'deepseek';
      const newKey = 'sk-deepseek-test';

      if (newKey && isCurrentPrimaryUnset && selectedTab !== settings.primaryProvider) {
        settings.primaryProvider = selectedTab;
        settings.fallbackChain = computeFallbackChain(selectedTab);
      }

      expect(settings.primaryProvider).toBe('deepseek');
      expect(settings.fallbackChain).toEqual(['gemini', 'openai', 'custom']);
    });
  });
});
