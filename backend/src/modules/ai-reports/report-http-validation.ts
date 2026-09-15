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
    if (query.report_type !== undefined) enumInput(query.report_type, ['daily', 'weekly', 'on_demand', 'audit_rule']);
    return;
  }
  if (!['POST', 'PUT'].includes(request.method)) return;
  const body = objectInput(request.body === undefined && route.endsWith('/cancel') ? {} : request.body);
  if (route.endsWith('/cancel')) { if (Object.keys(body).length) throw new RequestValidationError('Cancellation body must be empty'); return; }
  if (route.endsWith('/settings/models')) {
    const allowed = ['type', 'apiKey', 'baseUrl'];
    if (Object.keys(body).some(key => !allowed.includes(key))) throw new RequestValidationError('Invalid models request field');
    if (body.type !== undefined) enumInput(body.type, ['gemini', 'deepseek', 'openai', 'custom']);
    if (body.apiKey !== undefined) stringInput(body.apiKey, 1024);
    if (body.baseUrl !== undefined) stringInput(body.baseUrl, 500);
    return;
  }
  if (route.endsWith('/settings/test-ai')) {
    const allowed = ['type', 'apiKey', 'model', 'baseUrl', 'supportsVision'];
    if (Object.keys(body).some(key => !allowed.includes(key))) throw new RequestValidationError('Invalid test-ai request field');
    if (body.type !== undefined) enumInput(body.type, ['gemini', 'deepseek', 'openai', 'custom']);
    if (body.apiKey !== undefined && body.apiKey !== null) stringInput(body.apiKey, 1024);
    if (body.model !== undefined && body.model !== '' && body.model !== null) {
      stringInput(body.model, 100);
      if (!/^[a-zA-Z0-9.:_\/-]+$/.test(body.model as string)) throw new RequestValidationError('Invalid model identifier format');
    }
    if (body.baseUrl !== undefined && body.baseUrl !== null) stringInput(body.baseUrl, 500);
    if (body.supportsVision !== undefined && body.supportsVision !== null) bool(body.supportsVision);
    return;
  }
  if (!route.endsWith('/settings')) return;
  if (Object.keys(body).some(key => !['automation', 'smtp', 'aiProviders'].includes(key))) throw new RequestValidationError('Unknown settings field');
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
  if (body.aiProviders !== undefined) {
    const aiProviders = objectInput(body.aiProviders);
    const allowed = ['primaryProvider', 'providers', 'fallbackEnabled', 'fallbackChain', 'allowSystemFallback', 'isSystemDefault'];
    if (Object.keys(aiProviders).some(key => !allowed.includes(key))) throw new RequestValidationError('Invalid aiProviders field');
    if (aiProviders.isSystemDefault !== undefined) bool(aiProviders.isSystemDefault);
    if (aiProviders.primaryProvider !== undefined) enumInput(aiProviders.primaryProvider, ['gemini', 'deepseek', 'openai', 'custom']);
    if (aiProviders.fallbackEnabled !== undefined) bool(aiProviders.fallbackEnabled);
    if (aiProviders.allowSystemFallback !== undefined) bool(aiProviders.allowSystemFallback);
    if (aiProviders.fallbackChain !== undefined) {
      strings(aiProviders.fallbackChain, 10, 50);
      for (const item of aiProviders.fallbackChain as string[]) {
        enumInput(item, ['gemini', 'deepseek', 'openai', 'custom']);
      }
    }
    if (aiProviders.providers !== undefined) {
      const providers = objectInput(aiProviders.providers);
      for (const [providerKey, providerCfg] of Object.entries(providers)) {
        enumInput(providerKey, ['gemini', 'deepseek', 'openai', 'custom']);
        const cfg = objectInput(providerCfg);
        const cfgAllowed = ['type', 'apiKey', 'model', 'baseUrl', 'supportsVision', 'maxTokens', 'apiKeySet'];
        if (Object.keys(cfg).some(key => !cfgAllowed.includes(key))) throw new RequestValidationError('Invalid provider config field');
        if (cfg.type !== undefined) enumInput(cfg.type, ['gemini', 'deepseek', 'openai', 'custom']);
        if (cfg.model !== undefined && cfg.model !== '' && cfg.model !== null) {
          stringInput(cfg.model, 100);
          if (!/^[a-zA-Z0-9.:_\/-]+$/.test(cfg.model as string)) throw new RequestValidationError('Invalid model identifier format');
        }
        if (cfg.apiKey !== undefined && cfg.apiKey !== null) stringInput(cfg.apiKey, 1024);
        if (cfg.baseUrl !== undefined && cfg.baseUrl !== null) stringInput(cfg.baseUrl, 500);
        if (cfg.supportsVision !== undefined && cfg.supportsVision !== null) bool(cfg.supportsVision);
        if (cfg.apiKeySet !== undefined && cfg.apiKeySet !== null) bool(cfg.apiKeySet);
        if (cfg.maxTokens !== undefined && cfg.maxTokens !== null && (typeof cfg.maxTokens !== 'number' || !Number.isInteger(cfg.maxTokens) || cfg.maxTokens < 1 || cfg.maxTokens > 128000)) {
          throw new RequestValidationError('Invalid maxTokens');
        }
      }
    }
  }
}
