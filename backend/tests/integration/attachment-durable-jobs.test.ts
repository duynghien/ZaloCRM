process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_long_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  processMessageAttachmentsAsync,
  recoverPendingAttachmentDownloads,
} from '../../src/modules/attachments/attachment-processor.js';
import * as worker from '../../src/modules/attachments/attachment-download-worker.js';
import { prisma } from '../../src/shared/database/prisma-client.js';
import * as downloader from '../../src/modules/attachments/attachment-downloader.js';

vi.mock('../../src/shared/database/prisma-client.js', () => {
  const mockPrisma: any = {
    message: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  };
  return { prisma: mockPrisma };
});

const getSql = (callArg: any): string => {
  if (!callArg) return '';
  if (typeof callArg === 'string') return callArg;
  if (Array.isArray(callArg)) return callArg.join('');
  if (Array.isArray(callArg[0])) return callArg[0].join('');
  if (callArg[0]?.sql) return callArg[0].sql;
  if (callArg[0]?.strings) return callArg[0].strings.join('');
  return '';
};

describe('Durable Attachment Download Queue Integration Tests', () => {
  const orgId = 'org-att-test';
  const messageId = 'msg-att-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts pending jobs into attachment_download_jobs for remote URLs', async () => {
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as any);

    const attachments = [
      {
        url: 'https://zdn.vn/media/img1.png',
        filename: 'img1.png',
      },
      {
        url: '/api/v1/attachments/already-local.png',
        localPath: '/tmp/already-local.png',
        extractedText: 'Already extracted text',
      },
      {
        url: 'https://zalo.me/cdn/file2.pdf',
        filename: 'file2.pdf',
      },
    ];

    await processMessageAttachmentsAsync(messageId, attachments, 0, orgId);

    // Should insert 2 remote attachments (img1.png and file2.pdf), skipping already-local
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);

    const call1 = vi.mocked(prisma.$executeRaw).mock.calls[0];
    const sql1 = getSql(call1);
    expect(sql1).toContain('attachment_download_jobs');
    expect(sql1).toContain('ON CONFLICT ("message_id", "attachment_index") DO NOTHING');

    await new Promise((r) => setImmediate(r));
  });

  it('executes download, updates attachments via jsonb_set, and marks job completed on success', async () => {
    const job = {
      id: 'job-1',
      org_id: orgId,
      message_id: messageId,
      attachment_index: 0,
      remote_url: 'https://zdn.vn/media/doc.pdf',
      attempt_count: 0,
    };

    vi.mocked(prisma.message.findUnique).mockResolvedValueOnce({
      id: messageId,
      attachments: [{ url: job.remote_url, filename: 'doc.pdf' }],
      conversationId: 'conv-1',
      conversation: { orgId, zaloAccountId: 'acc-1' },
    } as any);

    vi.spyOn(downloader, 'downloadAttachmentDetailed').mockResolvedValueOnce({
      success: true,
      result: {
        localPath: '/uploads/attachments/org-att-test/org-att-test-uuid-doc.pdf',
        filename: 'org-att-test-uuid-doc.pdf',
        originalName: 'doc.pdf',
        size: 1024,
        mimeType: 'application/pdf',
      },
    });

    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ attachments: [{ url: '/api/v1/attachments/org-att-test-uuid-doc.pdf' }] }] as any);
    vi.mocked(prisma.$executeRaw).mockResolvedValueOnce(1 as any);

    await worker.processSingleAttachmentJob(job);

    // Verifies jsonb_set update on messages table
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const queryCall = vi.mocked(prisma.$queryRaw).mock.calls[0];
    const querySql = getSql(queryCall);
    expect(querySql).toContain('jsonb_set');
    expect(querySql).toContain('messages');

    // Verifies status transitioned to completed
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const execCall = vi.mocked(prisma.$executeRaw).mock.calls[0];
    const execSql = getSql(execCall);
    expect(execSql).toContain("SET \"status\" = 'completed'");
  });

  it('fails immediately without retrying on permanent CDN errors (404, 410, 403)', async () => {
    const job = {
      id: 'job-404',
      org_id: orgId,
      message_id: messageId,
      attachment_index: 0,
      remote_url: 'https://zdn.vn/expired-link.jpg',
      attempt_count: 0,
    };

    vi.mocked(prisma.message.findUnique).mockResolvedValueOnce({
      id: messageId,
      attachments: [{ url: job.remote_url }],
      conversationId: 'conv-1',
      conversation: { orgId, zaloAccountId: 'acc-1' },
    } as any);

    vi.spyOn(downloader, 'downloadAttachmentDetailed').mockResolvedValueOnce({
      success: false,
      status: 404,
      error: 'HTTP 404',
    });

    vi.mocked(prisma.$executeRaw).mockResolvedValueOnce(1 as any);

    await worker.processSingleAttachmentJob(job);

    // Must update status directly to 'failed' with permanent failure error
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const execCall = vi.mocked(prisma.$executeRaw).mock.calls[0];
    const execSql = getSql(execCall);
    expect(execSql).toContain("SET \"status\" = 'failed'");
    expect(execSql).toContain('Permanent CDN failure (HTTP 404)');
    // Must NOT have scheduled a pending retry
    expect(execSql).not.toContain("SET \"status\" = 'pending'");
  });

  it('schedules exponential backoff on transient network errors when attemptCount < 5', async () => {
    const job = {
      id: 'job-transient',
      org_id: orgId,
      message_id: messageId,
      attachment_index: 0,
      remote_url: 'https://zdn.vn/temp-fail.jpg',
      attempt_count: 1, // Will become 2
    };

    vi.mocked(prisma.message.findUnique).mockResolvedValueOnce({
      id: messageId,
      attachments: [{ url: job.remote_url }],
      conversationId: 'conv-1',
      conversation: { orgId, zaloAccountId: 'acc-1' },
    } as any);

    vi.spyOn(downloader, 'downloadAttachmentDetailed').mockResolvedValueOnce({
      success: false,
      status: 503,
      error: 'Service Unavailable',
    });

    vi.mocked(prisma.$executeRaw).mockResolvedValueOnce(1 as any);

    await worker.processSingleAttachmentJob(job);

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const execCall = vi.mocked(prisma.$executeRaw).mock.calls[0];
    const execSql = getSql(execCall);
    expect(execSql).toContain("SET \"status\" = 'pending'");
    expect(execSql).toContain('"attempt_count" =');
    expect(execCall[1]).toBe(2);
    expect(execSql).toContain("INTERVAL '1 minute'");
  });

  it('permanently marks job failed when attemptCount reaches 5', async () => {
    const job = {
      id: 'job-max-retries',
      org_id: orgId,
      message_id: messageId,
      attachment_index: 0,
      remote_url: 'https://zdn.vn/always-fail.jpg',
      attempt_count: 4, // Next is 5
    };

    vi.mocked(prisma.message.findUnique).mockResolvedValueOnce({
      id: messageId,
      attachments: [{ url: job.remote_url }],
      conversationId: 'conv-1',
      conversation: { orgId, zaloAccountId: 'acc-1' },
    } as any);

    vi.spyOn(downloader, 'downloadAttachmentDetailed').mockResolvedValueOnce({
      success: false,
      status: 500,
      error: 'Internal Server Error',
    });

    vi.mocked(prisma.$executeRaw).mockResolvedValueOnce(1 as any);

    await worker.processSingleAttachmentJob(job);

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const execCall = vi.mocked(prisma.$executeRaw).mock.calls[0];
    const execSql = getSql(execCall);
    expect(execSql).toContain("SET \"status\" = 'failed'");
    expect(execSql).toContain('"attempt_count" =');
    expect(execCall[1]).toBe(5);
  });

  it('bounds concurrent downloads using concurrency limiter', async () => {
    const limit = worker.pLimit(5);
    let active = 0;
    let maxObserved = 0;

    const task = async () => {
      return limit(async () => {
        active++;
        maxObserved = Math.max(maxObserved, active);
        await new Promise((r) => setTimeout(r, 20));
        active--;
      });
    };

    // Run 15 concurrent tasks through pLimit(5)
    await Promise.all(Array.from({ length: 15 }, () => task()));

    expect(maxObserved).toBeLessThanOrEqual(5);
  });

  it('recovers pending downloads without 24-hour cutoff', async () => {
    vi.spyOn(worker, 'tickAttachmentQueue').mockResolvedValue(undefined);
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as any);

    // Old message from 5 days ago with remote attachment
    const oldMessage = {
      id: 'old-msg-1',
      attachments: [{ url: 'https://zdn.vn/old-attachment.pdf' }],
      conversation: { orgId },
    };

    vi.mocked(prisma.message.findMany).mockResolvedValueOnce([oldMessage] as any);

    await recoverPendingAttachmentDownloads();

    // 1. Reclaims stalled leases
    // 2. Inserts job for old-attachment.pdf
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);

    const reclaimCall = vi.mocked(prisma.$executeRaw).mock.calls[0];
    expect(getSql(reclaimCall)).toContain("WHERE \"status\" = 'downloading' AND \"lease_expires_at\" < NOW()");

    const enrollCall = vi.mocked(prisma.$executeRaw).mock.calls[1];
    expect(getSql(enrollCall)).toContain('attachment_download_jobs');
  });
});
