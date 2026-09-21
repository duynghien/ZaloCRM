/**
 * KiotViet Product Service
 *
 * Local catalog query and search service partitioned by (orgId, retailer, branchId).
 * Enforces normal goods only, active & allowsSale flags, and sanitized DTO projection.
 */

import { prisma } from '../../../shared/database/prisma-client.js';
import { sanitizeProductDto } from './kiotviet-serializer.js';
import type { KiotvietProductDto } from './kiotviet-types.js';

export async function searchLocalProducts(
  orgId: string,
  query = '',
  limit = 20
): Promise<KiotvietProductDto[]> {
  const boundedLimit = Math.min(Math.max(1, limit), 50);
  const trimmedQuery = query.trim().slice(0, 100);

  // 1. Fetch current sync state to identify active retailer and branch partition
  const syncState = await prisma.kiotvietSyncState.findUnique({
    where: { orgId },
  });

  if (!syncState?.retailer || !syncState.branchId) {
    return [];
  }

  const { retailer, branchId } = syncState;

  // 2. Query partitioned products
  const where: any = {
    orgId,
    retailer,
    branchId,
    isActive: true,
    allowsSale: true,
    productType: 'normal',
    hasSerial: false,
    hasBatch: false,
  };

  if (trimmedQuery) {
    where.OR = [
      { code: { contains: trimmedQuery, mode: 'insensitive' } },
      { name: { contains: trimmedQuery, mode: 'insensitive' } },
    ];
  }

  const products = await prisma.kiotvietProduct.findMany({
    where,
    take: boundedLimit,
    orderBy: [
      { code: 'asc' },
    ],
  });

  return products.map(p => sanitizeProductDto(p));
}
