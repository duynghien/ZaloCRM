/**
 * attachment-ticket-service.ts — Issues and verifies Short-lived Media Tickets (HMAC 60s)
 * for secure file streaming without leaking long-lived JWTs in URLs.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../../config/index.js';

interface TicketPayload {
  f: string; // filename
  o: string; // orgId
  exp: number; // expiration timestamp in seconds
}

/**
 * Generate a short-lived HMAC media ticket (default TTL: 60 seconds).
 */
export function createMediaTicket(filename: string, orgId: string, ttlSeconds = 60): string {
  const payload: TicketPayload = {
    f: filename,
    o: orgId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };

  const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', config.jwtSecret)
    .update(payloadStr)
    .digest('base64url');

  return `${payloadStr}.${signature}`;
}

/**
 * Verify HMAC media ticket and return the decoded payload if valid and unexpired.
 */
export function verifyMediaTicket(ticket: string): { filename: string; orgId: string } | null {
  if (!ticket || typeof ticket !== 'string') return null;

  const parts = ticket.split('.');
  if (parts.length !== 2) return null;

  const [payloadStr, signature] = parts;

  const expectedSignature = createHmac('sha256', config.jwtSecret)
    .update(payloadStr)
    .digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);

  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload: TicketPayload = JSON.parse(Buffer.from(payloadStr, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);

    if (!payload.f || !payload.o || typeof payload.exp !== 'number' || payload.exp < now) {
      return null;
    }

    return {
      filename: payload.f,
      orgId: payload.o,
    };
  } catch {
    return null;
  }
}
