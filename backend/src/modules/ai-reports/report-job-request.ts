import { calendarInstant } from '../../shared/http/request-schemas.js';
/** Public selectors stay separate from the server-resolved, immutable job snapshot. */
import type { ReportTarget } from './report-target-service.js';

export type ReportJobRequest = {
  fromDate: string; toDate: string;
  groupThreadIds: string[];
  groupTargets?: Array<{ zaloAccountId: string; groupThreadId: string }>;
  senderAccountId?: string;
  title?: string;
  reportType: 'daily' | 'weekly' | 'on_demand';
  sendZalo: boolean; sendEmail: boolean;
  zaloDestinationType: 'self' | 'cloud' | 'uid';
  zaloTargetUid?: string;
  zaloDeliveryMode?: 'dual_pdf' | 'full_text';
  emailRecipients: string[];
};
export type FrozenReportJobRequest = Omit<ReportJobRequest, 'groupTargets' | 'groupThreadIds'> & {
  schemaVersion: 2; origin: 'on_demand' | 'scheduled'; targets: ReportTarget[];
};
export class ReportJobValidationError extends Error {
  constructor(message: string, public statusCode = 400) { super(message); }
}
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value;
function date(value: unknown): string { try { return calendarInstant(value); } catch { throw new ReportJobValidationError('Invalid report date range'); } }
export function normalizeReportJobRequest(input: Record<string, unknown>): ReportJobRequest {
  const fromDate = date(input.from_date); const toDate = date(input.to_date);
  const span = Date.parse(toDate) - Date.parse(fromDate);
  if (span < 0 || span > 30 * 86400000) throw new ReportJobValidationError('Report range must not exceed 31 days');
  const explicit = input.group_targets !== undefined;
  if (explicit && input.group_thread_ids !== undefined) throw new ReportJobValidationError('Do not mix group selectors');
  let groupTargets: ReportJobRequest['groupTargets']; let groupThreadIds: string[] = [];
  if (explicit) {
    if (!Array.isArray(input.group_targets)) throw new ReportJobValidationError('Invalid group targets');
    groupTargets = input.group_targets.map(target => {
      if (!target || typeof target !== 'object' || Array.isArray(target) || Object.keys(target).some(key => !['zalo_account_id', 'group_thread_id'].includes(key)) || !identifier(target.zalo_account_id) || !identifier(target.group_thread_id)) throw new ReportJobValidationError('Invalid group target');
      return { zaloAccountId: target.zalo_account_id, groupThreadId: target.group_thread_id };
    }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    if (!groupTargets.length || groupTargets.length > 20 || new Set(groupTargets.map(t => JSON.stringify(t))).size !== groupTargets.length) throw new ReportJobValidationError('Select between 1 and 20 unique groups');
  } else {
    if (!Array.isArray(input.group_thread_ids) || input.group_thread_ids.some(id => !identifier(id))) throw new ReportJobValidationError('Invalid group IDs');
    groupThreadIds = [...input.group_thread_ids].sort();
    if (!groupThreadIds.length || groupThreadIds.length > 20 || new Set(groupThreadIds).size !== groupThreadIds.length) throw new ReportJobValidationError('Select between 1 and 20 unique groups');
  }
  for (const key of ['send_zalo', 'send_email']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new ReportJobValidationError(`${key} must be boolean`);
  if (input.email_recipients !== undefined && (!Array.isArray(input.email_recipients) || input.email_recipients.some(value => typeof value !== 'string'))) throw new ReportJobValidationError('Invalid email recipients');
  const emailRecipients = ((input.email_recipients ?? []) as string[]).map(email => email.trim().toLowerCase()).sort();
  if (emailRecipients.length > 10 || new Set(emailRecipients).size !== emailRecipients.length || emailRecipients.some(email => email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new ReportJobValidationError('Email recipients must be up to 10 unique valid addresses');
  const sendZalo = input.send_zalo === true; const sendEmail = input.send_email === true;
  const destination = input.zalo_destination_type === undefined ? 'self' : input.zalo_destination_type;
  if (!['self', 'cloud', 'uid'].includes(destination as string)) throw new ReportJobValidationError('Invalid Zalo destination');
  if (input.zalo_account_id !== undefined && !identifier(input.zalo_account_id)) throw new ReportJobValidationError('Invalid sender account');
  if (sendZalo && !identifier(input.zalo_account_id)) throw new ReportJobValidationError('zalo_account_id sender is required');
  if (input.zalo_target_uid !== undefined && !identifier(input.zalo_target_uid)) throw new ReportJobValidationError('Invalid zalo_target_uid');
  if (sendZalo && destination === 'uid' && !input.zalo_target_uid) throw new ReportJobValidationError('zalo_target_uid is required');
  if (input.title !== undefined && (typeof input.title !== 'string' || input.title.length > 200)) throw new ReportJobValidationError('Invalid report title');
  if (input.report_type !== undefined && !['daily', 'weekly', 'on_demand'].includes(input.report_type as string)) throw new ReportJobValidationError('Invalid report type');
  if (input.zalo_delivery_mode !== undefined && !['dual_pdf', 'full_text'].includes(input.zalo_delivery_mode as string)) throw new ReportJobValidationError('Invalid Zalo delivery mode');
  const zaloDeliveryMode = input.zalo_delivery_mode === 'full_text' ? 'full_text' : 'dual_pdf';
  return { fromDate, toDate, groupThreadIds, ...(groupTargets ? { groupTargets } : {}), ...(input.zalo_account_id ? { senderAccountId: input.zalo_account_id as string } : {}), ...(input.title !== undefined ? { title: input.title as string } : {}), reportType: (input.report_type ?? 'on_demand') as ReportJobRequest['reportType'], sendZalo, sendEmail, zaloDestinationType: destination as ReportJobRequest['zaloDestinationType'], ...(input.zalo_target_uid ? { zaloTargetUid: input.zalo_target_uid as string } : {}), zaloDeliveryMode, emailRecipients };
}
