/**
 * chat-copilot-parser.ts — Two-tier resilient JSON parser & schema normalizer for Copilot output.
 */
import type {
  CopilotAnalysisResult,
  CopilotBuyingIntent,
  CopilotSentiment,
  SmartReplyTone,
  AnomalySeverity,
  AnomalyCategory,
} from './chat-copilot-types.js';

export function parseRawCopilotJson(raw: string): any {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();

  // Tier 1: Direct JSON parse
  try {
    return JSON.parse(trimmed);
  } catch {}

  // Tier 2: Extract from ```json ... ``` codeblock
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (match?.[1]) {
    try {
      return JSON.parse(match[1].trim());
    } catch {}
  }

  // Fallback: Extract from first { to last }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {}
  }

  return null;
}

export function normalizeCopilotResult(
  conversationId: string,
  rawObj: any,
): CopilotAnalysisResult | null {
  if (!rawObj || typeof rawObj !== 'object') return null;

  const validSentiments: CopilotSentiment[] = ['positive', 'neutral', 'curious', 'hesitant', 'frustrated', 'angry'];
  const validIntents: CopilotBuyingIntent[] = ['none', 'exploring', 'considering', 'ready_to_buy'];
  const validTones: SmartReplyTone[] = ['consultative', 'closing', 'supportive'];
  const validSeverities: AnomalySeverity[] = ['low', 'medium', 'high', 'critical'];
  const validCategories: AnomalyCategory[] = ['harassment', 'scam_allegation', 'service_complaint', 'chargeback_threat'];

  const rawInsights = rawObj.insights || {};
  const sentiment: CopilotSentiment = validSentiments.includes(rawInsights.sentiment)
    ? rawInsights.sentiment
    : 'neutral';
  const buyingIntent: CopilotBuyingIntent = validIntents.includes(rawInsights.buyingIntent)
    ? rawInsights.buyingIntent
    : 'none';
  const sentimentScore = typeof rawInsights.sentimentScore === 'number'
    ? Math.max(0, Math.min(100, Math.round(rawInsights.sentimentScore)))
    : 50;
  const intentConfidence = typeof rawInsights.intentConfidence === 'number'
    ? Math.max(0, Math.min(1, rawInsights.intentConfidence))
    : 0.5;
  const customerSummary = typeof rawInsights.customerSummary === 'string'
    ? rawInsights.customerSummary.slice(0, 200)
    : '';

  const rawReplies = Array.isArray(rawObj.smartReplies) ? rawObj.smartReplies : [];
  const smartReplies = rawReplies.slice(0, 4).map((r: any, idx: number) => ({
    id: typeof r.id === 'string' && r.id ? r.id : `reply_${idx + 1}`,
    label: typeof r.label === 'string' ? r.label.slice(0, 30) : `Gợi ý ${idx + 1}`,
    content: typeof r.content === 'string' ? r.content : '',
    tone: validTones.includes(r.tone) ? (r.tone as SmartReplyTone) : 'consultative',
  })).filter((r: any) => Boolean(r.content));

  const rawDraft = rawObj.quickDraft || {};
  const quickDraft = {
    hasActionableData: Boolean(rawDraft.hasActionableData),
    extractedContact: rawDraft.extractedContact ? {
      fullName: rawDraft.extractedContact.fullName || undefined,
      phone: rawDraft.extractedContact.phone || undefined,
      address: rawDraft.extractedContact.address || undefined,
    } : undefined,
    orderDraft: rawDraft.orderDraft ? {
      suggestedItems: Array.isArray(rawDraft.orderDraft.suggestedItems)
        ? rawDraft.orderDraft.suggestedItems.map((item: any) => ({
            name: String(item.name || 'Sản phẩm'),
            quantity: Number(item.quantity) || 1,
            unitPrice: typeof item.unitPrice === 'number' ? item.unitPrice : undefined,
          }))
        : [],
      estimatedTotal: typeof rawDraft.orderDraft.estimatedTotal === 'number'
        ? rawDraft.orderDraft.estimatedTotal
        : undefined,
      shippingAddress: rawDraft.orderDraft.shippingAddress || undefined,
      notes: rawDraft.orderDraft.notes || undefined,
    } : undefined,
    appointmentDraft: rawDraft.appointmentDraft ? {
      appointmentDate: String(rawDraft.appointmentDraft.appointmentDate || ''),
      appointmentTime: rawDraft.appointmentDraft.appointmentTime || undefined,
      notes: rawDraft.appointmentDraft.notes || undefined,
    } : undefined,
  };

  const rawAnomaly = rawObj.anomalyAlert || {};
  const anomalyAlert = {
    triggered: Boolean(rawAnomaly.triggered),
    severity: validSeverities.includes(rawAnomaly.severity) ? rawAnomaly.severity : 'low',
    category: validCategories.includes(rawAnomaly.category) ? rawAnomaly.category : undefined,
    reason: typeof rawAnomaly.reason === 'string' ? rawAnomaly.reason : undefined,
  };

  return {
    conversationId,
    analyzedAt: new Date().toISOString(),
    insights: {
      sentiment,
      sentimentScore,
      buyingIntent,
      intentConfidence,
      customerSummary,
    },
    smartReplies,
    quickDraft,
    anomalyAlert,
  };
}
