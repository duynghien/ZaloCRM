import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import {
  useChatCopilot,
  bindCopilotSocket,
  unbindCopilotSocket,
  type CopilotAnalysisResult,
} from '../src/composables/use-chat-copilot';
import { api } from '../src/api/index';

describe('useChatCopilot composable', () => {
  const sampleSuggestion: CopilotAnalysisResult = {
    conversationId: 'conv-101',
    analyzedAt: '2026-09-17T12:00:00.000Z',
    insights: {
      sentiment: 'positive',
      sentimentScore: 85,
      buyingIntent: 'ready_to_buy',
      intentConfidence: 0.92,
      customerSummary: 'Khách muốn chốt 2 hộp kem nám',
    },
    smartReplies: [
      { id: 'r1', label: 'Báo giá 900k', content: 'Dạ 2 hộp là 900k freeship ạ!', tone: 'closing' },
    ],
    quickDraft: {
      hasActionableData: true,
      orderDraft: {
        suggestedItems: [{ name: 'Kem nám', quantity: 2, unitPrice: 450000 }],
        estimatedTotal: 900000,
        shippingAddress: '12 Tràng Thi, Hà Nội',
      },
      extractedContact: {
        fullName: 'Chị Mai',
        phone: '0912345678',
        address: '12 Tràng Thi, Hà Nội',
      },
    },
    anomalyAlert: {
      triggered: false,
      severity: 'low',
    },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    const { clearSuggestion } = useChatCopilot();
    clearSuggestion('conv-101');
  });

  it('updates suggestionMap when socket receives chat:copilot_suggestion', () => {
    const handlers: Record<string, (payload: any) => void> = {};
    const mockSocket: any = {
      on: (event: string, handler: any) => { handlers[event] = handler; },
      off: (event: string) => { delete handlers[event]; },
    };

    bindCopilotSocket(mockSocket);

    const activeConvId = ref<string | null>('conv-101');
    const { currentSuggestion, clearSuggestion } = useChatCopilot(activeConvId);

    expect(currentSuggestion.value).toBeNull();

    // Trigger socket event
    handlers['chat:copilot_suggestion'](sampleSuggestion);
    expect(currentSuggestion.value).not.toBeNull();
    expect(currentSuggestion.value?.insights.buyingIntent).toBe('ready_to_buy');
    expect(currentSuggestion.value?.smartReplies[0].label).toBe('Báo giá 900k');

    // Clear suggestion
    clearSuggestion('conv-101');
    expect(currentSuggestion.value).toBeNull();

    unbindCopilotSocket(mockSocket);
  });

  it('tracks and resolves anomaly alert via socket and API', async () => {
    const handlers: Record<string, (payload: any) => void> = {};
    const mockSocket: any = {
      on: (event: string, handler: any) => { handlers[event] = handler; },
      off: (event: string) => { delete handlers[event]; },
    };

    bindCopilotSocket(mockSocket);

    const activeConvId = ref<string | null>('conv-risk-1');
    const { currentAnomaly, resolveAnomaly } = useChatCopilot(activeConvId);

    // Trigger anomaly socket event
    handlers['chat:anomaly_alert']({
      conversationId: 'conv-risk-1',
      severity: 'critical',
      reason: 'Khách dọa bóc phốt vì giao nhầm sản phẩm',
      accountId: 'acc-1',
    });

    expect(currentAnomaly.value).not.toBeNull();
    expect(currentAnomaly.value?.severity).toBe('critical');
    expect(currentAnomaly.value?.reason).toContain('giao nhầm');

    // Resolve via API
    vi.spyOn(api, 'patch').mockResolvedValue({ data: { success: true } });
    const resolved = await resolveAnomaly('conv-risk-1');
    expect(resolved).toBe(true);
    expect(currentAnomaly.value).toBeNull();

    unbindCopilotSocket(mockSocket);
  });

  it('enriches contact data via PATCH /contacts/:id', async () => {
    const patchSpy = vi.spyOn(api, 'patch').mockResolvedValue({ data: { id: 'c-1' } });
    const { confirmEnrichContact } = useChatCopilot();

    const ok = await confirmEnrichContact('c-1', {
      phone: '0987654321',
      address: '100 Nguyễn Huệ, Q1, HCM',
    });

    expect(ok).toBe(true);
    expect(patchSpy).toHaveBeenCalledWith('/contacts/c-1', {
      phone: '0987654321',
      shippingAddress: '100 Nguyễn Huệ, Q1, HCM',
    });
  });
});
