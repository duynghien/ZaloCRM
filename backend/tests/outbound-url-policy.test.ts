import { describe, expect, it } from 'vitest';
import { isPublicIp } from '../src/shared/security/outbound-url-policy.js';

describe('outbound URL address policy', () => {
  it.each([
    '127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254',
    '0.0.0.0', '100.64.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1',
    '2001:db8::1',
  ])('rejects non-public address %s', (address) => {
    expect(isPublicIp(address)).toBe(false);
  });

  it.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'])('allows public address %s', (address) => {
    expect(isPublicIp(address)).toBe(true);
  });
});
