/**
 * webhook-signature-service.ts — Dual-version HMAC signature generator and secret decryptor.
 * Produces X-Webhook-Signature (V1 legacy) and X-Webhook-Signature-V2 (with replay timestamp).
 */
import crypto from 'node:crypto';
import { config } from '../../../config/index.js';
import { decryptString, encryptData } from '../../../shared/utils/crypto.js';

export function encryptWebhookSecret(secret: string): Uint8Array {
  const cipher = encryptData(secret, config.encryptionKey);
  return new Uint8Array(Buffer.from(cipher, 'utf8'));
}

export function decryptSigningSecret(secretEncrypted: Uint8Array | Buffer | null | undefined): string | null {
  if (!secretEncrypted) return null;
  const str = Buffer.from(secretEncrypted).toString('utf8');
  return decryptString(str, config.encryptionKey);
}

export function decryptWebhookSecret(secretEncrypted: Uint8Array | Buffer | null | undefined): string {
  const secret = decryptSigningSecret(secretEncrypted);
  return secret || '';
}

export function computeWebhookSignatureV1(payloadString: string, secret: string | null): string {
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
}

export function computeWebhookSignatureV2(
  payloadString: string,
  secret: string | null,
  dispatchTimestamp: string
): string {
  if (!secret) return '';
  return crypto
    .createHmac('sha256', secret)
    .update(`${dispatchTimestamp}.${payloadString}`)
    .digest('hex');
}

export function computeWebhookSignatures(
  payloadString: string,
  secret: string | null,
  dispatchTimestamp: string
): { signatureV1: string; signatureV2: string } {
  return {
    signatureV1: computeWebhookSignatureV1(payloadString, secret),
    signatureV2: computeWebhookSignatureV2(payloadString, secret, dispatchTimestamp),
  };
}

export function matchesEventPattern(pattern: string, event: string): boolean {
  if (pattern === '*' || pattern === event) return true;
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2);
    return event.startsWith(`${prefix}.`);
  }
  return false;
}
