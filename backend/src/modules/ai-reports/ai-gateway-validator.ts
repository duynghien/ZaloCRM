/**
 * ai-gateway-validator.ts — SSRF validation for external and local AI Gateway endpoints.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isPublicIp } from '../../shared/security/outbound-url-policy.js';
import { config } from '../../config/index.js';

export async function validateAiGatewayUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Base URL không phải là URL hợp lệ');
  }

  // Local AI gateways (Ollama, vLLM on LAN/localhost) permitted only when ALLOW_PRIVATE_AI_GATEWAYS=true
  if (config.allowPrivateAiGateways) {
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Base URL phải sử dụng giao thức HTTP hoặc HTTPS');
    }
    return;
  }

  // Strict SaaS / Public cloud mode: HTTPS only, no credentials, public DNS/IP only
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) {
    throw new Error('Base URL phải sử dụng giao thức HTTPS công khai và không chứa thông tin đăng nhập');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (hostname.toLowerCase() === 'localhost') {
    throw new Error('Không được phép sử dụng localhost khi ALLOW_PRIVATE_AI_GATEWAYS tắt');
  }

  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIp(address))) {
    throw new Error('Base URL trỏ đến dải IP nội bộ hoặc không công khai');
  }
}
