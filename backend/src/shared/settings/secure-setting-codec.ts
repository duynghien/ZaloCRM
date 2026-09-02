import { config } from '../../config/index.js';
import { decryptData, encryptData } from '../utils/crypto.js';

type SecureSetting = {
  valuePlain: string | null;
  valueEncrypted: Uint8Array<ArrayBuffer> | null;
};

/**
 * Encodes secrets for AppSetting without changing the legacy plain-text read
 * contract. Callers should rewrite legacy values after a successful save.
 */
export function encodeSecureSetting(value: string): Pick<SecureSetting, 'valuePlain' | 'valueEncrypted'> {
  return {
    valuePlain: null,
    valueEncrypted: new TextEncoder().encode(encryptData(value, config.encryptionKey)),
  };
}

/** Reads encrypted values first and retains compatibility with unrotated rows. */
export function decodeSecureSetting(setting: SecureSetting | null | undefined): string | null {
  if (!setting) return null;
  if (setting.valueEncrypted) {
    const decrypted = decryptData<string>(new TextDecoder().decode(setting.valueEncrypted), config.encryptionKey);
    return typeof decrypted === 'string' ? decrypted : null;
  }
  return setting.valuePlain;
}
