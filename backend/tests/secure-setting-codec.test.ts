import { describe, expect, it } from 'vitest';
import { decodeSecureSetting, encodeSecureSetting } from '../src/shared/settings/secure-setting-codec.js';

describe('secure setting codec', () => {
  it('encrypts a new secret without persisting plaintext', () => {
    const stored = encodeSecureSetting('smtp-password');

    expect(stored.valuePlain).toBeNull();
    expect(stored.valueEncrypted).not.toBeNull();
    expect(new TextDecoder().decode(stored.valueEncrypted!)).not.toContain('smtp-password');
    expect(decodeSecureSetting(stored)).toBe('smtp-password');
  });

  it('reads legacy plaintext only for migration compatibility', () => {
    expect(decodeSecureSetting({ valuePlain: 'legacy-secret', valueEncrypted: null })).toBe('legacy-secret');
  });
});
