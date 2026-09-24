import { RequestValidationError } from './request-schemas.js';

const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9._:-]+$/;

/**
 * Validates that an idempotency key is a valid non-empty string between 1 and 256 characters,
 * strictly matching `^[A-Za-z0-9._:-]+$`. Leading/trailing whitespace is not trimmed and is rejected.
 */
export function validateIdempotencyKey(key: unknown): string {
  if (typeof key !== 'string' || key.length === 0 || key.length > 256 || !IDEMPOTENCY_KEY_REGEX.test(key)) {
    throw new RequestValidationError('Invalid or missing Idempotency-Key. Expected 1-256 characters matching ^[A-Za-z0-9._:-]+$');
  }
  return key;
}
