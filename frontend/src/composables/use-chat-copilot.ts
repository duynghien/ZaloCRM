/**
 * use-chat-copilot.ts — Composable managing Copilot suggestions and anomaly alerts.
 */
import { ref, computed, type Ref } from 'vue';
import type { Socket } from 'socket.io-client';
import { api } from '@/api/index';

export interface SmartReply {
  id: string;
  label: string;
  content: string;
  tone: 'consultative' | 'closing' | 'supportive';
}

export interface CopilotInsights {
  sentiment: 'positive' | 'neutral' | 'curious' | 'hesitant' | 'frustrated' | 'angry';
  sentimentScore: number;
  buyingIntent: 'none' | 'exploring' | 'considering' | 'ready_to_buy';
  intentConfidence: number;
  customerSummary: string;
}

export interface CopilotQuickDraft {
  hasActionableData: boolean;
  extractedContact?: {
    fullName?: string;
    phone?: string;
    address?: string;
  };
  orderDraft?: {
    suggestedItems: Array<{ name: string; quantity: number; unitPrice?: number }>;
    estimatedTotal?: number;
    shippingAddress?: string;
    notes?: string;
  };
  appointmentDraft?: {
    appointmentDate: string;
    appointmentTime?: string;
    notes?: string;
  };
}

export interface CopilotAnomalyAlert {
  triggered: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category?: 'harassment' | 'scam_allegation' | 'service_complaint' | 'chargeback_threat';
  reason?: string;
}

export interface CopilotAnalysisResult {
  conversationId: string;
  analyzedAt: string;
  insights: CopilotInsights;
  smartReplies: SmartReply[];
  quickDraft: CopilotQuickDraft;
  anomalyAlert: CopilotAnomalyAlert;
}

// Module-level singleton state
const suggestionMap = ref<Map<string, CopilotAnalysisResult>>(new Map());
const activeAnomalyMap = ref<Map<string, { severity: string; reason?: string; accountId?: string }>>(new Map());
const loadingManual = ref(false);
const manualError = ref<string | null>(null);

export function bindCopilotSocket(socket: Socket): void {
  socket.on('chat:copilot_suggestion', (payload: CopilotAnalysisResult) => {
    if (payload?.conversationId) {
      suggestionMap.value.set(payload.conversationId, payload);
    }
  });

  socket.on('chat:anomaly_alert', (payload: { conversationId: string; severity: string; reason?: string; accountId?: string }) => {
    if (payload?.conversationId) {
      activeAnomalyMap.value.set(payload.conversationId, payload);
    }
  });

  socket.on('chat:anomaly_resolved', (payload: { conversationId: string }) => {
    if (payload?.conversationId) {
      activeAnomalyMap.value.delete(payload.conversationId);
    }
  });
}

export function unbindCopilotSocket(socket: Socket): void {
  socket.off('chat:copilot_suggestion');
  socket.off('chat:anomaly_alert');
  socket.off('chat:anomaly_resolved');
}

export function useChatCopilot(currentConvId?: Ref<string | null>) {
  const currentSuggestion = computed<CopilotAnalysisResult | null>(() => {
    const id = currentConvId?.value;
    return id ? suggestionMap.value.get(id) || null : null;
  });

  const currentAnomaly = computed(() => {
    const id = currentConvId?.value;
    return id ? activeAnomalyMap.value.get(id) || null : null;
  });

  async function requestManualCopilot(convId: string): Promise<CopilotAnalysisResult | null> {
    if (!convId || loadingManual.value) return null;
    loadingManual.value = true;
    manualError.value = null;
    try {
      const res = await api.post(`/conversations/${convId}/copilot/suggest`);
      if (res.data?.conversationId) {
        suggestionMap.value.set(res.data.conversationId, res.data);
        return res.data;
      }
      return null;
    } catch (err: any) {
      manualError.value = err?.response?.data?.error || 'Không thể lấy gợi ý Copilot';
      return null;
    } finally {
      loadingManual.value = false;
    }
  }

  function clearSuggestion(convId: string): void {
    if (convId) {
      suggestionMap.value.delete(convId);
    }
  }

  async function resolveAnomaly(convId: string): Promise<boolean> {
    if (!convId) return false;
    try {
      await api.patch(`/conversations/${convId}/resolve-anomaly`);
      activeAnomalyMap.value.delete(convId);
      return true;
    } catch {
      return false;
    }
  }

  async function confirmEnrichContact(
    contactId: string,
    data: { phone?: string; address?: string },
  ): Promise<boolean> {
    if (!contactId) return false;
    try {
      const payload: Record<string, any> = {};
      if (data.phone) payload.phone = data.phone;
      if (data.address) payload.shippingAddress = data.address;
      await api.patch(`/contacts/${contactId}`, payload);
      return true;
    } catch {
      return false;
    }
  }

  return {
    suggestionMap,
    activeAnomalyMap,
    currentSuggestion,
    currentAnomaly,
    loadingManual,
    manualError,
    requestManualCopilot,
    clearSuggestion,
    resolveAnomaly,
    confirmEnrichContact,
    bindCopilotSocket,
    unbindCopilotSocket,
  };
}
