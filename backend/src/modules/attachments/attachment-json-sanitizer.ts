/**
 * attachment-json-sanitizer.ts — Null-byte sanitation for JSONB database storage.
 */
import { logger } from '../../shared/utils/logger.js';

/**
 * Recursively strips null bytes (\u0000) from strings, arrays, and plain objects.
 * Guarantees safe serialization into PostgreSQL JSONB columns without triggering 22P05.
 * Includes a maxDepth guard (20 levels) with iterative fallback and 1MB size warning.
 */
export function sanitizeJsonNullBytes(input: any, depth = 0, maxDepth = 20): any {
  if (input === null || input === undefined) {
    return input;
  }

  if (depth === 0) {
    try {
      const str = JSON.stringify(input);
      if (str && str.length > 1024 * 1024) {
        logger.warn(
          `[attachment-processor] Large attachment payload detected (${(str.length / 1024 / 1024).toFixed(2)} MB), sanitizing null bytes with care`,
        );
      }
    } catch {
      // ignore
    }
  }

  if (typeof input === 'string') {
    return input.replace(/\u0000/g, '');
  }

  if (typeof input !== 'object') {
    return input;
  }

  if (depth >= maxDepth) {
    return sanitizeJsonIterative(input);
  }

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeJsonNullBytes(item, depth + 1, maxDepth));
  }

  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(input)) {
    const cleanKey = typeof key === 'string' ? key.replace(/\u0000/g, '') : key;
    result[cleanKey] = sanitizeJsonNullBytes(val, depth + 1, maxDepth);
  }
  return result;
}

function sanitizeJsonIterative(root: any): any {
  if (root === null || typeof root !== 'object') {
    return typeof root === 'string' ? root.replace(/\u0000/g, '') : root;
  }

  const rootCopy = Array.isArray(root) ? [...root] : { ...root };
  const stack: Array<{ parent: any; key: string | number; value: any }> = [];

  if (Array.isArray(rootCopy)) {
    for (let i = 0; i < rootCopy.length; i++) {
      stack.push({ parent: rootCopy, key: i, value: rootCopy[i] });
    }
  } else {
    for (const [k, v] of Object.entries(rootCopy)) {
      stack.push({ parent: rootCopy, key: k, value: v });
    }
  }

  while (stack.length > 0) {
    const item = stack.pop()!;
    const val = item.value;
    if (typeof val === 'string') {
      item.parent[item.key] = val.replace(/\u0000/g, '');
    } else if (val && typeof val === 'object') {
      const copy = Array.isArray(val) ? [...val] : { ...val };
      item.parent[item.key] = copy;
      if (Array.isArray(copy)) {
        for (let i = 0; i < copy.length; i++) {
          stack.push({ parent: copy, key: i, value: copy[i] });
        }
      } else {
        for (const [k, v] of Object.entries(copy)) {
          stack.push({ parent: copy, key: k, value: v });
        }
      }
    }
  }

  return rootCopy;
}
