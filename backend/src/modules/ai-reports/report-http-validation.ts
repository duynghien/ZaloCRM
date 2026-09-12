import type { FastifyRequest } from 'fastify';
import { objectInput, identifierInput, stringInput, enumInput, RequestValidationError } from '../../shared/http/request-schemas.js';
const bool = (value: unknown) => { if (typeof value !== 'boolean') throw new RequestValidationError('Expected boolean'); };
const strings = (value: unknown, max: number, length: number) => { if (!Array.isArray(value) || value.length > max) throw new RequestValidationError('Invalid array'); for (const item of value) stringInput(item, length); };
/** Runs after authentication; validates HTTP shape without AJV scalar coercion. */
export function validateReportHttpRequest(request: FastifyRequest): void {
  const params = request.params as Record<string, unknown>;
  for (const value of Object.values(params ?? {})) identifierInput(value);
  const route = request.routeOptions.url ?? '';
  if (request.method === 'GET') {
    const query = request.query as Record<string, unknown>;
    if (query.report_type !== undefined) enumInput(query.report_type, ['daily', 'weekly', 'on_demand']);
    return;
  }
  if (!['POST', 'PUT'].includes(request.method)) return;
  const body = objectInput(request.body === undefined && route.endsWith('/cancel') ? {} : request.body);
  if (route.endsWith('/cancel')) { if (Object.keys(body).length) throw new RequestValidationError('Cancellation body must be empty'); return; }
  if (!route.endsWith('/settings')) return;
  if (Object.keys(body).some(key => !['automation', 'smtp'].includes(key))) throw new RequestValidationError('Unknown settings field');
  if (body.automation !== undefined) {
    const automation = objectInput(body.automation);
    const allowed = ['dailyEnabled', 'weeklyEnabled', 'sendZalo', 'sendEmail', 'senderAccountId', 'zaloDestinationType', 'zaloTargetUid', 'emailRecipients'];
    if (Object.keys(automation).some(key => !allowed.includes(key))) throw new RequestValidationError('Invalid automation field');
    for (const key of ['dailyEnabled', 'weeklyEnabled', 'sendZalo', 'sendEmail']) if (automation[key] !== undefined) bool(automation[key]);
    if (automation.senderAccountId !== undefined) identifierInput(automation.senderAccountId);
    if (automation.zaloTargetUid !== undefined) identifierInput(automation.zaloTargetUid);
    if (automation.zaloDestinationType !== undefined) enumInput(automation.zaloDestinationType, ['self', 'cloud', 'uid']);
    if (automation.emailRecipients !== undefined) {
      strings(automation.emailRecipients, 10, 254);
      const recipients = (automation.emailRecipients as string[]).map(email => email.trim().toLowerCase());
      if (new Set(recipients).size !== recipients.length || recipients.some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new RequestValidationError('Invalid email recipients');
    }
  }
  if (body.smtp !== undefined) {
    const smtp = objectInput(body.smtp);
    if (Object.keys(smtp).some(key => !['host', 'port', 'secure', 'auth', 'user', 'pass', 'from'].includes(key))) throw new RequestValidationError('Invalid SMTP field');
    for (const key of ['host', 'user', 'pass', 'from']) if (smtp[key] !== undefined) stringInput(smtp[key], key === 'pass' ? 4096 : 320);
    if (smtp.port !== undefined && (typeof smtp.port !== 'number' || !Number.isInteger(smtp.port) || smtp.port < 1 || smtp.port > 65535)) throw new RequestValidationError('Invalid SMTP port');
    if (smtp.secure !== undefined) bool(smtp.secure);
    if (smtp.auth !== undefined) {
      const auth = objectInput(smtp.auth);
      if (Object.keys(auth).some(key => !['user', 'pass'].includes(key))) throw new RequestValidationError('Invalid SMTP auth field');
      for (const key of ['user', 'pass']) if (auth[key] !== undefined) stringInput(auth[key], key === 'pass' ? 4096 : 320);
    }
  }
}
