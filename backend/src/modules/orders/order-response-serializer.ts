import { Prisma } from '@prisma/client';

/**
 * Serializes Order and nested relations so that:
 * - BigInt fields become strings
 * - Decimal fields become numbers
 * - Dates become ISO strings
 * Prevents Fastify runtime crash when serializing BigInt values.
 */
export function serializeOrderResponse<T>(data: T): T {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'bigint') {
    return data.toString() as unknown as T;
  }

  if (data instanceof Prisma.Decimal) {
    return (data as Prisma.Decimal).toNumber() as unknown as T;
  }

  if (data instanceof Date) {
    return data.toISOString() as unknown as T;
  }

  if (Array.isArray(data)) {
    return data.map(item => serializeOrderResponse(item)) as unknown as T;
  }

  if (typeof data === 'object') {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = serializeOrderResponse(value);
    }
    return result as T;
  }

  return data;
}
