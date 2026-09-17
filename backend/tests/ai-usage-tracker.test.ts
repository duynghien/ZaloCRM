import { describe, expect, it, vi } from 'vitest';
import {
  recordAiUsageAsync,
  cleanupOldAiUsageLogs,
  getVnDateString,
} from '../src/modules/ai-reports/ai-usage-tracker.js';

describe('ai-usage-tracker', () => {
  it('normalizes UTC+7 date correctly', () => {
    const testDate = new Date('2026-09-17T01:00:00Z'); // 08:00 AM UTC+7
    const vnDate = getVnDateString(testDate);
    expect(vnDate).toBe('2026-09-17');
  });

  it('records raw log and atomic upsert with proper token counts', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: 'log-1' });
    const mockExecuteRaw = vi.fn().mockResolvedValue(1);

    const mockPrisma = {
      aiUsageLog: {
        create: mockCreate,
      },
      $executeRaw: mockExecuteRaw,
    } as any;

    await recordAiUsageAsync(
      {
        orgId: 'org-123',
        userId: 'user-456',
        taskType: 'copilot',
        provider: 'gemini',
        model: 'gemini-3.6-flash',
        usage: {
          inputTokens: 1000,
          outputTokens: 200,
          cachedTokens: 100,
        },
        durationMs: 450,
        status: 'success',
      },
      mockPrisma,
    );

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const createCallArg = mockCreate.mock.calls[0][0];
    expect(createCallArg.data.orgId).toBe('org-123');
    expect(createCallArg.data.userId).toBe('user-456');
    expect(createCallArg.data.taskType).toBe('copilot');
    expect(createCallArg.data.inputTokens).toBe(1000);
    expect(createCallArg.data.outputTokens).toBe(200);
    expect(createCallArg.data.cachedTokens).toBe(100);
    expect(createCallArg.data.totalTokens).toBe(1200);
    expect(createCallArg.data.durationMs).toBe(450);

    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
  });

  it('swallows database errors safely without throwing exception', async () => {
    const mockFailingPrisma = {
      aiUsageLog: {
        create: vi.fn().mockRejectedValue(new Error('DB Connection Lost')),
      },
      $executeRaw: vi.fn(),
    } as any;

    // Must not throw
    await expect(
      recordAiUsageAsync(
        {
          orgId: 'org-123',
          taskType: 'test_connection',
          provider: 'openai',
          model: 'gpt-4o-mini',
          status: 'failed',
        },
        mockFailingPrisma,
      ),
    ).resolves.not.toThrow();
  });

  it('cleans up old raw logs past retention window', async () => {
    const mockDeleteMany = vi.fn().mockResolvedValue({ count: 42 });
    const mockPrisma = {
      aiUsageLog: {
        deleteMany: mockDeleteMany,
      },
    } as any;

    const count = await cleanupOldAiUsageLogs(90, mockPrisma);
    expect(count).toBe(42);
    expect(mockDeleteMany).toHaveBeenCalledTimes(1);
    const whereArg = mockDeleteMany.mock.calls[0][0].where;
    expect(whereArg.createdAt.lt).toBeInstanceOf(Date);
  });
});
