import { describe, expect, it } from 'vitest';
import { normalizeReportJobRequest, ReportJobValidationError } from '../src/modules/ai-reports/report-job-request.js';

const request = (overrides: Record<string, unknown> = {}) => ({
  from_date: '2026-01-01',
  to_date: '2026-01-31',
  group_thread_ids: ['group-1'],
  ...overrides,
});

describe('AI report job request bounds', () => {
  it('accepts the documented inclusive 31-day window and normalizes recipients', () => {
    const result = normalizeReportJobRequest(request({
      email_recipients: ['OPS@EXAMPLE.COM'],
      send_email: true,
    }));

    expect(result.emailRecipients).toEqual(['ops@example.com']);
    expect(result.reportType).toBe('on_demand');
  });

  it.each([
    request({ to_date: '2026-02-01' }),
    request({ group_thread_ids: Array.from({ length: 21 }, (_, index) => `group-${index}`) }),
    request({ group_thread_ids: ['group-1', 'group-1'] }),
    request({ email_recipients: Array.from({ length: 11 }, (_, index) => `user${index}@example.com`) }),
    request({ send_zalo: true, zalo_destination_type: 'uid' }),
  ])('rejects a request beyond its cost or dispatch boundary', (payload) => {
    expect(() => normalizeReportJobRequest(payload)).toThrow(ReportJobValidationError);
  });
});
