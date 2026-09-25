/**
 * ai-report-task-routes.ts — Endpoints for report action items completion status and Zalo group broadcasting.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../shared/database/prisma-client.js';
import { sendReportToZalo, formatTasksForZaloMessage } from '../zalo-report-sender.js';
import type { ReportActionItem } from '../report-action-item-parser.js';
import { decodeReportTargets, authorizeReportAccount } from '../report-target-service.js';
import { canAccessReport } from './ai-report-route-helpers.js';

export async function aiReportTaskRoutes(app: FastifyInstance) {
  // ── 1. Update task completion status (Action Item) ──────────────────────────
  app.put('/api/v1/ai-reports/:id/tasks/:taskId', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const params = request.params as { id: string; taskId: string };
    const { done } = request.body as { done: boolean };

    const report = await prisma.generatedReport.findUnique({
      where: { id: params.id },
    });

    if (!report || report.orgId !== user.orgId) {
      return reply.status(404).send({ error: 'Report not found' });
    }

    if (!(await canAccessReport(user, report, 'chat'))) {
      return reply.status(404).send({ error: 'Report not found' });
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'report-task:' + user.orgId + ':' + params.id}))`;
      const fresh = await tx.generatedReport.findUnique({
        where: { id: params.id },
        select: { structuredData: true },
      });
      if (!fresh) return null;

      const structuredData =
        typeof fresh.structuredData === 'object' && fresh.structuredData !== null
          ? ({ ...fresh.structuredData } as Record<string, any>)
          : {};

      const items: ReportActionItem[] = Array.isArray(structuredData.actionItems)
        ? [...structuredData.actionItems]
        : [];

      const taskIndex = items.findIndex((t) => t.id === params.taskId);
      if (taskIndex === -1) {
        return { notFound: true };
      }

      const updatedTask: ReportActionItem = {
        ...items[taskIndex],
        done,
        completedAt: done ? new Date().toISOString() : undefined,
      };
      items[taskIndex] = updatedTask;
      structuredData.actionItems = items;

      await tx.generatedReport.update({
        where: { id: params.id },
        data: { structuredData },
      });

      return { task: updatedTask, actionItems: items };
    });

    if (!result || (result as any).notFound) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    return { success: true, task: (result as any).task, actionItems: (result as any).actionItems };
  });

  // ── 2. Broadcast actionable tasks to verified source Zalo group ────────────
  app.post('/api/v1/ai-reports/:id/broadcast-tasks', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const params = request.params as { id: string };
    const rawIdempotencyKey = request.headers['idempotency-key'];
    const idempotencyKey = typeof rawIdempotencyKey === 'string' ? rawIdempotencyKey.trim() : '';

    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      return reply.status(400).send({ error: 'Header Idempotency-Key is required (8-128 chars)' });
    }

    const body = request.body as {
      senderAccountId: string;
      targetThreadId: string;
      selectedTaskIds?: string[];
      customHeaderNote?: string;
    };

    const report = await prisma.generatedReport.findUnique({
      where: { id: params.id },
    });

    if (!report || report.orgId !== user.orgId) {
      return reply.status(404).send({ error: 'Report not found' });
    }

    if (!(await canAccessReport(user, report, 'chat'))) {
      return reply.status(404).send({ error: 'Report not found' });
    }

    // Anti-Exfiltration Target Bounds: Ensure targetThreadId is among verified report sources
    const verifiedTargets = decodeReportTargets(report.sourceTargets);
    const targetMatch = verifiedTargets.find((t) => t.groupThreadId === body.targetThreadId);
    if (!targetMatch) {
      return reply.status(400).send({ error: 'Target thread does not belong to the verified sources of this report' });
    }

    // Permission: Verify user has chat access to the sending account
    const hasAccountAccess = await authorizeReportAccount(user.orgId, body.senderAccountId, user, 'chat');
    if (!hasAccountAccess) {
      return reply.status(403).send({ error: 'You do not have permission to send messages from this Zalo account' });
    }

    // Check existing broadcast history for idempotency replay
    const metadata =
      typeof report.metadata === 'object' && report.metadata !== null
        ? ({ ...report.metadata } as Record<string, any>)
        : {};
    const broadcastHistory: any[] = Array.isArray(metadata.broadcastHistory) ? [...metadata.broadcastHistory] : [];
    const previousBroadcast = broadcastHistory.find((h) => h.idempotencyKey === idempotencyKey);
    if (previousBroadcast) {
      return { success: true, replay: true, partsSent: previousBroadcast.partsSent, taskCount: previousBroadcast.taskCount };
    }

    const structuredData =
      typeof report.structuredData === 'object' && report.structuredData !== null
        ? (report.structuredData as Record<string, any>)
        : {};
    const allTasks: ReportActionItem[] = Array.isArray(structuredData.actionItems) ? structuredData.actionItems : [];

    let tasksToBroadcast = allTasks;
    if (body.selectedTaskIds && body.selectedTaskIds.length > 0) {
      tasksToBroadcast = allTasks.filter((t) => body.selectedTaskIds!.includes(t.id));
    }

    if (tasksToBroadcast.length === 0) {
      return reply.status(400).send({ error: 'No actionable tasks available to broadcast' });
    }

    const structured = (report.structuredData && typeof report.structuredData === 'object')
      ? (report.structuredData as Record<string, any>)
      : {};
    const digests = Array.isArray(structured?.groupDigests) ? structured.groupDigests : [];
    const groupDigest = digests.find((d: any) => d.groupThreadId === body.targetThreadId);
    const targetGroupName = groupDigest?.groupName || `Nhóm ${targetMatch.groupThreadId}`;

    const formattedMessage = formatTasksForZaloMessage(
      report.title,
      targetGroupName,
      tasksToBroadcast,
      body.customHeaderNote,
    );

    const dispatchResult = await sendReportToZalo({
      accountId: body.senderAccountId,
      orgId: user.orgId,
      destinationType: 'group',
      targetThreadId: body.targetThreadId,
      markdownContent: formattedMessage,
      customPrefixType: 'none',
      executionGuard: async () => {
        const acc = await prisma.zaloAccount.findFirst({
          where: { id: body.senderAccountId, orgId: user.orgId, status: 'connected' },
          select: { id: true },
        });
        if (!acc) throw new Error('report_sender_unavailable');
      },
    });

    if (!dispatchResult.success) {
      return reply.status(502).send({ error: dispatchResult.error || 'Failed to dispatch tasks to Zalo group' });
    }

    // Persist to broadcastHistory
    broadcastHistory.push({
      idempotencyKey,
      sentAt: new Date().toISOString(),
      sentByUserId: user.id,
      targetThreadId: body.targetThreadId,
      taskCount: tasksToBroadcast.length,
      partsSent: dispatchResult.partsSent,
    });
    metadata.broadcastHistory = broadcastHistory;

    await prisma.generatedReport.update({
      where: { id: params.id },
      data: { metadata },
    });

    return { success: true, partsSent: dispatchResult.partsSent, taskCount: tasksToBroadcast.length };
  });
}
