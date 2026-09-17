import { describe, it, expect } from 'vitest';
import { transformContactReport, transformAppointmentReport } from '../src/views/reports-data-transformers';
import type { DailyTimelineItem, TaskTypeBreakdown, ModelBreakdown } from '../src/api/ai-usage-api';

describe('Reports Data Transformers', () => {
  it('transforms contact report raw data accurately', () => {
    const raw = {
      newPerDay: [
        { date: '2026-09-15', count: 5 },
        { date: '2026-09-16', count: 8 },
      ],
      treatmentProgress: [
        { status: 'improving', count: 12 },
      ],
      medicationStatus: [
        { status: 'adherent', count: 18 },
      ],
    };

    const transformed = transformContactReport(raw);
    expect(transformed).toEqual([
      { label: 'Mới 2026-09-15', count: 5 },
      { label: 'Mới 2026-09-16', count: 8 },
      { label: 'Tiến triển: improving', count: 12 },
      { label: 'Thuốc: adherent', count: 18 },
    ]);
  });

  it('handles empty contact report gracefully', () => {
    expect(transformContactReport(null)).toEqual([]);
    expect(transformContactReport({})).toEqual([]);
  });

  it('transforms appointment report raw data accurately', () => {
    const raw = {
      byStatus: [
        { status: 'confirmed', count: 10 },
        { status: 'cancelled', count: 2 },
      ],
      byType: [
        { type: 'consultation', count: 8 },
        { type: null, count: 4 },
      ],
    };

    const transformed = transformAppointmentReport(raw);
    expect(transformed).toEqual([
      { label: 'Trạng thái: confirmed', count: 10 },
      { label: 'Trạng thái: cancelled', count: 2 },
      { label: 'Loại: consultation', count: 8 },
      { label: 'Loại: —', count: 4 },
    ]);
  });

  it('handles empty appointment report gracefully', () => {
    expect(transformAppointmentReport(null)).toEqual([]);
    expect(transformAppointmentReport({})).toEqual([]);
  });
});

describe('AI Usage Chart Data Formatting', () => {
  const taskLabels: Record<string, string> = {
    copilot: 'Chat Copilot',
    executive_report: 'Báo cáo điều hành',
    audit_rule: 'Quy tắc kiểm tra',
    vision_ocr: 'OCR hình ảnh',
    test_connection: 'Kiểm tra kết nối',
  };

  it('maps task types to human-readable Vietnamese labels', () => {
    expect(taskLabels['copilot']).toBe('Chat Copilot');
    expect(taskLabels['executive_report']).toBe('Báo cáo điều hành');
    expect(taskLabels['audit_rule']).toBe('Quy tắc kiểm tra');
    expect(taskLabels['vision_ocr']).toBe('OCR hình ảnh');
    expect(taskLabels['test_connection']).toBe('Kiểm tra kết nối');
    expect(taskLabels['unknown'] || 'unknown').toBe('unknown');
  });

  it('builds timeline chart labels and series', () => {
    const timeline: DailyTimelineItem[] = [
      { date: '2026-09-15', costVnd: 50000, costUsd: 2, totalTokens: 400000, requestCount: 25 },
      { date: '2026-09-16', costVnd: 75000, costUsd: 3, totalTokens: 600000, requestCount: 40 },
    ];

    const labels = timeline.map((d) => d.date.slice(5));
    const costData = timeline.map((d) => d.costVnd);
    const tokenData = timeline.map((d) => d.totalTokens);

    expect(labels).toEqual(['09-15', '09-16']);
    expect(costData).toEqual([50000, 75000]);
    expect(tokenData).toEqual([400000, 600000]);
  });

  it('builds donut breakdown data for tasks and models', () => {
    const tasks: TaskTypeBreakdown[] = [
      { taskType: 'copilot', costVnd: 60000, costUsd: 2.4, totalTokens: 500000, requestCount: 30, percentage: 60 },
      { taskType: 'audit_rule', costVnd: 40000, costUsd: 1.6, totalTokens: 300000, requestCount: 20, percentage: 40 },
    ];

    const models: ModelBreakdown[] = [
      { model: 'gemini-2.5-flash', provider: 'google', costVnd: 80000, costUsd: 3.2, totalTokens: 700000, requestCount: 45, percentage: 80 },
      { model: 'gpt-4o-mini', provider: 'openai', costVnd: 20000, costUsd: 0.8, totalTokens: 100000, requestCount: 5, percentage: 20 },
    ];

    expect(tasks.map((t) => taskLabels[t.taskType])).toEqual(['Chat Copilot', 'Quy tắc kiểm tra']);
    expect(models.map((m) => m.model)).toEqual(['gemini-2.5-flash', 'gpt-4o-mini']);
  });

  it('formats Excel download filename correctly', () => {
    const tabName = 'ai-usage';
    const dateFrom = '2026-09-01';
    const dateTo = '2026-09-17';
    const prefix = tabName === 'ai-usage' ? 'ai-usage-report' : `report-${tabName}`;
    const filename = `${prefix}-${dateFrom}-to-${dateTo}.xlsx`;
    expect(filename).toBe('ai-usage-report-2026-09-01-to-2026-09-17.xlsx');
  });
});
