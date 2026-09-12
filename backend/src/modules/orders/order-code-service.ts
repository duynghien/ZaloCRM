import type { Prisma } from '@prisma/client';

/** Allocate only inside the transaction that creates the corresponding order. */
export async function allocateOrderCode(tx: Prisma.TransactionClient, orgId: string, now = new Date()): Promise<string> {
  if (!Number.isFinite(now.getTime()) || now.getUTCFullYear() < 1 || now.getUTCFullYear() > 9999) {
    throw new Error('Invalid order allocation date');
  }
  const dateKey = now.toISOString().slice(0, 10).replaceAll('-', '');
  const pattern = `^ORD-${dateKey}-[0-9]{3,}$`;
  // The initial value handles sparse historical data if a counter is absent.
  // ON CONFLICT serializes concurrent creators without count-based collisions.
  const [counter] = await tx.$queryRaw<Array<{ last_value: bigint }>>`
    INSERT INTO order_code_counters(org_id,date_key,last_value)
      SELECT ${orgId},${dateKey},COALESCE(max(substring(order_code FROM 14)::numeric),0)::bigint + 1
      FROM orders WHERE org_id=${orgId} AND order_code ~ ${pattern}
    ON CONFLICT (org_id,date_key) DO UPDATE SET last_value=order_code_counters.last_value + 1
    RETURNING last_value`;
  if (!counter) throw new Error('Order code allocation failed');
  return `ORD-${dateKey}-${counter.last_value.toString().padStart(3, '0')}`;
}
