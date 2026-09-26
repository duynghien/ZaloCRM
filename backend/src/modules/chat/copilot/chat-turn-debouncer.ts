/**
 * chat-turn-debouncer.ts — Inbound conversation turn debouncer with AbortController race guard.
 */
import type { Server } from 'socket.io';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { emitAccountEvent } from '../../../shared/realtime/socket-event-delivery.js';
import { chatCopilotService } from './chat-copilot-service.js';
import { escalateChatAnomaly } from './chat-copilot-anomaly-escalator.js';
import { getAppSetting } from '../../../shared/settings/app-setting-service.js';
import type { CopilotMessageContext, CopilotContactContext } from './chat-copilot-types.js';

interface DebounceEntry {
  timer?: NodeJS.Timeout;
  accountId: string;
  orgId: string;
  firstMsgAt: number;
  generationToken: number;
  abortController?: AbortController;
}

export class ChatTurnDebouncer {
  private io: Server | null = null;
  private readonly entries = new Map<string, DebounceEntry>();
  private readonly MAX_TIMERS = 1000;
  private readonly MAX_WAIT_MS = 12_000;

  init(ioInstance: Server): void {
    this.io = ioInstance;
  }

  private clearEntry(entry: DebounceEntry): void {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = undefined;
    }
    if (entry.abortController) {
      entry.abortController.abort();
      entry.abortController = undefined;
    }
  }

  cleanup(): void {
    for (const entry of this.entries.values()) {
      this.clearEntry(entry);
    }
    this.entries.clear();
  }

  private async getOrgDebounceSettings(orgId: string): Promise<{ enabled: boolean; delayMs: number }> {
    try {
      const parsed = await getAppSetting(orgId, 'copilot_settings');
      if (parsed && typeof parsed === 'object') {
        return {
          enabled: parsed.copilotEnabled !== false,
          delayMs: Math.max(1500, Math.min(5000, Number(parsed.copilotDebounceMs) || 3000)),
        };
      }
    } catch {}
    return { enabled: true, delayMs: 3000 };
  }

  async handleMessageTurn(params: {
    conversationId: string;
    accountId: string;
    orgId: string;
    isSelf: boolean;
    threadType: 'user' | 'group';
  }): Promise<void> {
    const { conversationId, accountId, orgId, isSelf, threadType } = params;

    // 1. Staff outbound message cancels pending timers and in-flight calculations
    if (isSelf) {
      const existing = this.entries.get(conversationId);
      if (existing) {
        this.clearEntry(existing);
        this.entries.delete(conversationId);
      }
      return;
    }

    // 2. Only 1-on-1 chats are automatically debounced
    if (threadType !== 'user') return;

    // 3. Check organization copilot feature toggle
    const { enabled, delayMs } = await this.getOrgDebounceSettings(orgId);
    if (!enabled) return;

    const now = Date.now();
    let entry = this.entries.get(conversationId);

    if (!entry) {
      if (this.entries.size >= this.MAX_TIMERS) {
        const oldest = this.entries.keys().next().value;
        if (oldest) {
          const oldestEntry = this.entries.get(oldest);
          if (oldestEntry) {
            this.clearEntry(oldestEntry);
          }
          this.entries.delete(oldest);
        }
      }
      entry = { accountId, orgId, firstMsgAt: now, generationToken: 0 };
      this.entries.set(conversationId, entry);
    } else {
      entry.accountId = accountId;
      entry.orgId = orgId;
    }

    // Abort previous in-flight AI call if still computing
    if (entry.abortController) {
      entry.abortController.abort();
      entry.abortController = undefined;
      entry.generationToken++;
    }

    // Check Max Wait ceiling (12s) to prevent infinite debounce postponement
    const elapsedSinceFirst = now - entry.firstMsgAt;
    const effectiveDelay = elapsedSinceFirst + delayMs > this.MAX_WAIT_MS
      ? Math.max(0, this.MAX_WAIT_MS - elapsedSinceFirst)
      : delayMs;

    if (entry.timer) clearTimeout(entry.timer);

    entry.timer = setTimeout(() => {
      void this.executeDebouncedCopilot(conversationId);
    }, effectiveDelay);
    entry.timer.unref();
  }

  private async executeDebouncedCopilot(conversationId: string): Promise<void> {
    const entry = this.entries.get(conversationId);
    if (!entry || !this.io) return;

    const currentToken = ++entry.generationToken;
    const abortCtrl = new AbortController();
    entry.abortController = abortCtrl;
    entry.timer = undefined;

    try {
      // Load last 40 messages in chronological order for Copilot pruning
      const rawMsgs = await prisma.message.findMany({
        where: { conversationId },
        orderBy: { sentAt: 'desc' },
        take: 40,
        select: {
          id: true,
          senderType: true,
          senderName: true,
          content: true,
          contentType: true,
          sentAt: true,
          isDeleted: true,
        },
      });
      const messages: CopilotMessageContext[] = rawMsgs.reverse().map((m) => ({
        id: m.id,
        senderType: m.senderType === 'self' ? 'self' : 'contact',
        senderName: m.senderName,
        content: m.content,
        contentType: m.contentType,
        sentAt: m.sentAt,
        isDeleted: m.isDeleted,
      }));

      // Load contact information
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { contact: true },
      });
      const rawMeta = conv?.contact?.metadata;
      const contact: CopilotContactContext | null = conv?.contact ? {
        id: conv.contact.id,
        fullName: conv.contact.fullName,
        phone: conv.contact.phone,
        notes: conv.contact.notes,
        tags: Array.isArray(conv.contact.tags) ? (conv.contact.tags as string[]) : [],
        metadata: typeof rawMeta === 'object' && rawMeta !== null ? (rawMeta as Record<string, any>) : null,
      } : null;

      const result = await chatCopilotService.generateCopilotAnalysis(
        entry.orgId,
        conversationId,
        messages,
        contact,
        false,
        abortCtrl.signal,
      );

      // Verify token hasn't changed during calculation
      if (entry.generationToken !== currentToken || abortCtrl.signal.aborted || !result) {
        return;
      }

      // Emit suggestion to account staff with 'chat' permission
      await emitAccountEvent(this.io, entry.accountId, 'chat:copilot_suggestion', result);

      // Handle critical anomaly escalation (Phase 5)
      if (result.anomalyAlert.triggered && ['high', 'critical'].includes(result.anomalyAlert.severity)) {
        await escalateChatAnomaly({
          io: this.io,
          conversationId,
          orgId: entry.orgId,
          accountId: entry.accountId,
          alert: result.anomalyAlert,
          contactId: conv?.contactId,
          currentContactMeta: conv?.contact?.metadata,
        });
      }
    } catch (err: any) {
      logger.error(`[chat-turn-debouncer] Execution error for conv ${conversationId}:`, err?.message || err);
    } finally {
      if (this.entries.get(conversationId)?.generationToken === currentToken) {
        this.entries.delete(conversationId);
      }
    }
  }
}

export const chatTurnDebouncer = new ChatTurnDebouncer();
