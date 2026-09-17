/**
 * chat-copilot-anomaly-escalator.ts — Escalates critical chat anomalies to managers and audit log.
 */
import type { Server } from 'socket.io';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { emitAccountEvent, emitManagerEvent } from '../../../shared/realtime/socket-event-delivery.js';
import type { CopilotAnomalyAlert } from './chat-copilot-types.js';

export interface EscalateAnomalyParams {
  io: Server;
  conversationId: string;
  orgId: string;
  accountId: string;
  alert: CopilotAnomalyAlert;
  contactId?: string | null;
  currentContactMeta?: any;
}

export async function escalateChatAnomaly(params: EscalateAnomalyParams): Promise<void> {
  const { io, conversationId, orgId, accountId, alert, contactId, currentContactMeta } = params;

  try {
    if (contactId) {
      const mergedMeta = {
        ...(typeof currentContactMeta === 'object' && currentContactMeta !== null ? currentContactMeta : {}),
        escalationStatus: 'pending',
        escalationReason: alert.reason || 'Khiếu nại nghiêm trọng',
        escalatedAt: new Date().toISOString(),
      };

      await prisma.contact.update({
        where: { id: contactId },
        data: { metadata: mergedMeta },
      });
    }

    await prisma.activityLog.create({
      data: {
        orgId,
        action: 'CHAT_ANOMALY_DETECTED',
        entityType: 'conversation',
        entityId: conversationId,
        details: alert as any,
      },
    });

    const alertPayload = { conversationId, accountId, ...alert };
    await emitAccountEvent(io, accountId, 'chat:anomaly_alert', alertPayload);
    await emitManagerEvent(io, orgId, 'chat:anomaly_alert', alertPayload);
  } catch (err: any) {
    logger.error(`[chat-copilot-anomaly-escalator] Escalation error for conv ${conversationId}:`, err?.message || err);
  }
}
