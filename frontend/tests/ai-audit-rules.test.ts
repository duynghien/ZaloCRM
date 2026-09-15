import { describe, expect, it, vi, beforeEach } from 'vitest';
import { aiReportApi, type AuditRuleInput } from '../src/api/ai-report-api';
import { api } from '../src/api/index';

vi.mock('../src/api/index', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('Frontend AI Audit Rules API Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls GET /ai-reports/rules to fetch audit rules', async () => {
    const mockRules = [
      {
        id: 'rule-1',
        name: 'Kiểm tra báo cáo sáng',
        isEnabled: true,
        zaloAccountId: 'acc-1',
        groupThreadId: 'group-1',
        runTime: '10:00',
        daysOfWeek: [1, 2, 3, 4, 5],
        scanWindowType: 'since_start_of_day' as const,
        personnelType: 'all_group_members' as const,
        templateType: 'schedule_submission' as const,
        destinationType: 'group' as const,
        sendOperationalReminder: true,
        createdAt: '2026-09-14T00:00:00Z',
        updatedAt: '2026-09-14T00:00:00Z',
      },
    ];

    vi.mocked(api.get).mockResolvedValueOnce({ data: { rules: mockRules } });

    const result = await aiReportApi.getAuditRules();
    expect(api.get).toHaveBeenCalledWith('/ai-reports/rules');
    expect(result.rules).toEqual(mockRules);
  });

  it('calls POST /ai-reports/rules to create a new rule', async () => {
    const payload: AuditRuleInput = {
      name: 'Kiểm tra tiến độ ca chiều',
      isEnabled: true,
      zaloAccountId: 'acc-1',
      groupThreadId: 'group-1',
      runTime: '17:30',
      daysOfWeek: [1, 2, 3, 4, 5],
      scanWindowType: 'last_n_hours',
      scanWindowHours: 8,
      personnelType: 'explicit_list',
      personnelList: ['Nhân viên A', 'Nhân viên B'],
      templateType: 'work_progress',
      destinationType: 'group',
      targetGroupId: 'group-supervisor',
      sendOperationalReminder: true,
    };

    vi.mocked(api.post).mockResolvedValueOnce({ data: { rule: { ...payload, id: 'new-rule-id' } } });

    const result = await aiReportApi.createAuditRule(payload);
    expect(api.post).toHaveBeenCalledWith('/ai-reports/rules', payload);
    expect(result.rule.id).toBe('new-rule-id');
  });

  it('calls PUT /ai-reports/rules/:id to update an existing rule', async () => {
    const updates = { isEnabled: false };
    vi.mocked(api.put).mockResolvedValueOnce({ data: { rule: { id: 'rule-1', ...updates } } });

    const result = await aiReportApi.updateAuditRule('rule-1', updates);
    expect(api.put).toHaveBeenCalledWith('/ai-reports/rules/rule-1', updates);
    expect(result.rule.isEnabled).toBe(false);
  });

  it('calls DELETE /ai-reports/rules/:id to remove a rule', async () => {
    vi.mocked(api.delete).mockResolvedValueOnce({ data: { success: true } });

    const result = await aiReportApi.deleteAuditRule('rule-1');
    expect(api.delete).toHaveBeenCalledWith('/ai-reports/rules/rule-1');
    expect(result.success).toBe(true);
  });

  it('calls POST /ai-reports/rules/:id/run-now to trigger synchronous test run', async () => {
    const mockRunResult = {
      success: true,
      reportId: 'rep-created-123',
      supervisoryReportMarkdown: '# BÁO CÁO GIÁM SÁT',
      operationalReminderMessage: '🔔 Nhắc nhở',
      lastRunStatus: 'success' as const,
    };

    vi.mocked(api.post).mockResolvedValueOnce({ data: mockRunResult });

    const result = await aiReportApi.runAuditRuleNow('rule-1');
    expect(api.post).toHaveBeenCalledWith('/ai-reports/rules/rule-1/run-now');
    expect(result.reportId).toBe('rep-created-123');
    expect(result.lastRunStatus).toBe('success');
  });
});
