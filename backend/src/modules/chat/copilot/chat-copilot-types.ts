/**
 * chat-copilot-types.ts — Type definitions for Conversational Copilot Engine.
 */

export type CopilotSentiment = 'positive' | 'neutral' | 'curious' | 'hesitant' | 'frustrated' | 'angry';
export type CopilotBuyingIntent = 'none' | 'exploring' | 'considering' | 'ready_to_buy';
export type SmartReplyTone = 'consultative' | 'closing' | 'supportive';
export type AnomalySeverity = 'low' | 'medium' | 'high' | 'critical';
export type AnomalyCategory = 'harassment' | 'scam_allegation' | 'service_complaint' | 'chargeback_threat';

export interface SmartReply {
  id: string;
  label: string;
  content: string;
  tone: SmartReplyTone;
}

export interface QuickDraftItem {
  name: string;
  quantity: number;
  unitPrice?: number;
}

export interface ExtractedContact {
  fullName?: string;
  phone?: string;
  address?: string;
}

export interface OrderDraft {
  suggestedItems: QuickDraftItem[];
  estimatedTotal?: number;
  shippingAddress?: string;
  notes?: string;
}

export interface AppointmentDraft {
  appointmentDate: string; // YYYY-MM-DD
  appointmentTime?: string; // HH:mm
  notes?: string;
}

export interface CopilotInsights {
  sentiment: CopilotSentiment;
  sentimentScore: number; // 0 - 100
  buyingIntent: CopilotBuyingIntent;
  intentConfidence: number; // 0.0 - 1.0
  customerSummary: string; // 10-15 words
}

export interface CopilotQuickDraft {
  hasActionableData: boolean;
  extractedContact?: ExtractedContact;
  orderDraft?: OrderDraft;
  appointmentDraft?: AppointmentDraft;
}

export interface CopilotAnomalyAlert {
  triggered: boolean;
  severity: AnomalySeverity;
  category?: AnomalyCategory;
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

export interface CopilotMessageContext {
  id: string;
  senderType: 'self' | 'contact';
  senderName?: string | null;
  content: string | null;
  contentType: string;
  sentAt: Date | string;
}

export interface CopilotContactContext {
  id?: string;
  fullName?: string | null;
  phone?: string | null;
  tags?: string[];
  notes?: string | null;
  metadata?: Record<string, any> | null;
}
