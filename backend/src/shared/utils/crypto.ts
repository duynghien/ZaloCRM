/**
 * AES-256-GCM Encryption / Decryption Utility.
 * Encrypts sensitive credentials (like Zalo session cookies, tokens) before DB storage.
 * Supports legacy unencrypted JSON fallback for seamless migration.
 */
import crypto from 'node:crypto';
import { logger } from './logger.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard 96-bit IV for GCM

// Normalize key to 32 bytes using SHA-256
function deriveKey(secretKey: string): Buffer {
  return crypto.createHash('sha256').update(secretKey || 'dev-key-change-me-16b').digest();
}

/**
 * Encrypt any JS object or string into a formatted cipher string (iv:authTag:ciphertext).
 */
export function encryptData(data: any, secretKey: string): string {
  if (data === null || data === undefined) return '';

  const text = typeof data === 'string' ? data : JSON.stringify(data);
  const key = deriveKey(secretKey);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt a formatted cipher string (iv:authTag:ciphertext) back to JS object or string.
 * Transparently returns raw JSON/object if the input is legacy unencrypted data.
 */
export function decryptData<T = any>(encryptedStr: string | any, secretKey: string): T | null {
  if (!encryptedStr) return null;

  // If input is already a parsed JS object (legacy DB value), return it as is
  if (typeof encryptedStr === 'object') {
    return encryptedStr as T;
  }

  if (typeof encryptedStr !== 'string') return null;

  // Check if string matches cipher format (iv_hex:authTag_hex:encrypted_hex)
  const parts = encryptedStr.split(':');
  if (parts.length !== 3) {
    // Legacy fallback: attempt to parse as plain JSON string
    try {
      return JSON.parse(encryptedStr) as T;
    } catch {
      return encryptedStr as unknown as T;
    }
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  if (ivHex.length !== IV_LENGTH * 2 || authTagHex.length !== 32) {
    // Format mismatch fallback
    try {
      return JSON.parse(encryptedStr) as T;
    } catch {
      return encryptedStr as unknown as T;
    }
  }

  try {
    const key = deriveKey(secretKey);
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    try {
      return JSON.parse(decrypted) as T;
    } catch {
      return decrypted as unknown as T;
    }
  } catch (err) {
    logger.error('Failed to decrypt data:', err);
    // If decryption fails, attempt legacy JSON parse fallback
    try {
      return JSON.parse(encryptedStr) as T;
    } catch {
      return null;
    }
  }
}
