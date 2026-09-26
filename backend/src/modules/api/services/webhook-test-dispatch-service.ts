/**
 * webhook-test-dispatch-service.ts — Dispatches test webhook payloads to subscriptions with dual signatures.
 */
import { randomUUID } from 'node:crypto';
import { fetchPublicHttps } from '../../../shared/security/outbound-url-policy.js';
import {
  decryptWebhookSecret,
  computeWebhookSignatureV1,
  computeWebhookSignatureV2,
} from './webhook-signature-service.js';

export interface TestWebhookResult {
  success: boolean;
  statusCode?: number;
  latencyMs: number;
  error?: string;
}

export async function dispatchTestWebhook(sub: {
  targetUrl: string;
  secretEncrypted?: Uint8Array | Buffer | null;
  sendV1Signature?: boolean;
}, orgId: string): Promise<TestWebhookResult> {
  const secret = decryptWebhookSecret(sub.secretEncrypted);
  const testId = `wh-test-${randomUUID().slice(0, 8)}`;
  const nowIso = new Date().toISOString();
  const dispatchTimestamp = Math.floor(Date.now() / 1000).toString();

  const payloadObj = {
    id: testId,
    event: 'webhook.test',
    timestamp: nowIso,
    occurredAt: nowIso,
    orgId,
    data: { message: 'Kiểm tra kết nối Webhook từ ZaloCRM' },
  };
  const payloadString = JSON.stringify(payloadObj);
  const signatureV1 = computeWebhookSignatureV1(payloadString, secret);
  const signatureV2 = computeWebhookSignatureV2(payloadString, secret, dispatchTimestamp);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Webhook-Id': testId,
    'X-Webhook-Event': 'webhook.test',
    'X-Webhook-Timestamp': dispatchTimestamp,
    'X-Webhook-Signature-V2': signatureV2,
  };
  if (sub.sendV1Signature) {
    headers['X-Webhook-Signature'] = signatureV1;
  }

  const startTime = Date.now();
  try {
    const res = await fetchPublicHttps(sub.targetUrl, {
      method: 'POST',
      headers,
      body: payloadString,
      timeoutMs: 5000,
      maxRedirects: 0,
    });
    const latencyMs = Date.now() - startTime;
    return { success: res.ok, statusCode: res.status, latencyMs };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return { success: false, statusCode: 0, latencyMs, error: err.message };
  }
}
