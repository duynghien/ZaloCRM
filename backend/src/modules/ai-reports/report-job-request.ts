/**
 * Validation and normalization for the public AI report job request contract.
 * Kept independent of persistence so its cost limits can be tested directly.
 */
export type ReportJobRequest = {
  fromDate: string;
  toDate: string;
  groupThreadIds: string[];
  title?: string;
  reportType: 'daily' | 'weekly' | 'on_demand';
  sendZalo: boolean;
  sendEmail: boolean;
  zaloDestinationType: 'self' | 'cloud' | 'uid';
  zaloTargetUid?: string;
  emailRecipients: string[];
};

export class ReportJobValidationError extends Error {}

export function normalizeReportJobRequest(input: Record<string, unknown>): ReportJobRequest {
  const fromDate = String(input.from_date ?? '');
  const toDate = String(input.to_date ?? '');
  if (fromDate.length > 40 || toDate.length > 40) throw new ReportJobValidationError('Invalid report date range');
  const from = new Date(fromDate);
  const to = new Date(toDate);
  if (!fromDate || !toDate || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
    throw new ReportJobValidationError('Invalid report date range');
  }
  if (to.getTime() - from.getTime() > 30 * 24 * 60 * 60 * 1000) {
    throw new ReportJobValidationError('Report range must not exceed 31 days');
  }
  const groupThreadIds = Array.isArray(input.group_thread_ids) ? input.group_thread_ids.map(String) : [];
  if (!groupThreadIds.length || groupThreadIds.length > 20 || new Set(groupThreadIds).size !== groupThreadIds.length || groupThreadIds.some((id) => !id || id.length > 128)) {
    throw new ReportJobValidationError('Select between 1 and 20 unique groups');
  }
  const emailRecipients = Array.isArray(input.email_recipients) ? input.email_recipients.map((value) => String(value).trim().toLowerCase()) : [];
  if (emailRecipients.length > 10 || new Set(emailRecipients).size !== emailRecipients.length || emailRecipients.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new ReportJobValidationError('Email recipients must be up to 10 unique valid addresses');
  }
  const sendZalo = input.send_zalo === true;
  const sendEmail = input.send_email === true;
  const zaloDestinationType = input.zalo_destination_type === 'uid' ? 'uid' : input.zalo_destination_type === 'cloud' ? 'cloud' : 'self';
  const zaloTargetUid = typeof input.zalo_target_uid === 'string' ? input.zalo_target_uid.trim() : undefined;
  if (zaloTargetUid && zaloTargetUid.length > 128) throw new ReportJobValidationError('zalo_target_uid is too long');
  if (sendZalo && zaloDestinationType === 'uid' && !zaloTargetUid) throw new ReportJobValidationError('zalo_target_uid is required');
  if (typeof input.title === 'string' && input.title.length > 200) throw new ReportJobValidationError('Report title is too long');
  return { fromDate, toDate, groupThreadIds, title: typeof input.title === 'string' ? input.title : undefined, reportType: input.report_type === 'daily' || input.report_type === 'weekly' ? input.report_type : 'on_demand', sendZalo, sendEmail, zaloDestinationType, zaloTargetUid, emailRecipients };
}
