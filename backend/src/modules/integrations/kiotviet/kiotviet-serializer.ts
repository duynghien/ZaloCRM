import { Prisma } from '@prisma/client';

/**
 * Recursively serializes objects containing BigInt and Prisma Decimal values
 * so Fastify JSON serializer does not crash on BigInt or Decimal.
 */
export function serializeBigIntAndDecimal<T>(data: T): T {
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
    return data.map(item => serializeBigIntAndDecimal(item)) as unknown as T;
  }

  if (typeof data === 'object') {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = serializeBigIntAndDecimal(value);
    }
    return result as T;
  }

  return data;
}

/**
 * Sanitizes a KiotvietProduct database record into a safe public DTO for all authenticated members.
 * Strips rawAttributes, cost, and supplier information.
 */
export function sanitizeProductDto(product: {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  price: Prisma.Decimal | number;
  onHand: Prisma.Decimal | number | null;
}) {
  return {
    id: product.id,
    code: product.code,
    name: product.name,
    unit: product.unit,
    price: product.price instanceof Prisma.Decimal ? product.price.toNumber() : Number(product.price),
    onHand: product.onHand !== null && product.onHand !== undefined
      ? (product.onHand instanceof Prisma.Decimal ? product.onHand.toNumber() : Number(product.onHand))
      : null,
  };
}
