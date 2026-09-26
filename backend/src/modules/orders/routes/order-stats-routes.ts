/**
 * order-stats-routes.ts — Statistics and staff performance reporting routes for orders.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../shared/database/prisma-client.js';
import { RequestValidationError } from '../../../shared/http/request-schemas.js';
import { validOptionalDate } from '../../../shared/http/request-bounds.js';
import { getVnDayStartUtc } from '../../../shared/utils/date-utils.js';

export async function orderStatsRoutes(app: FastifyInstance): Promise<void> {
  // ── Order stats ───────────────────────────────────────────────────────────
  app.get('/api/v1/orders/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { from, to } = request.query as Record<string, string>;

    const where: any = { orgId: user.orgId };
    const fromDate = validOptionalDate(from);
    const toDate = validOptionalDate(to);
    if (toDate && /^\d{4}-\d{2}-\d{2}$/.test(to)) toDate.setUTCHours(23, 59, 59, 999);
    if (fromDate && toDate && fromDate > toDate) throw new RequestValidationError('Invalid date range');
    if ((from && !fromDate) || (to && !toDate)) return reply.status(400).send({ error: 'Invalid date range' });
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = fromDate;
      if (toDate) where.createdAt.lte = toDate;
    }

    const [total, completed, revenue, todayRevenue] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.count({ where: { ...where, status: 'completed' } }),
      prisma.order.aggregate({ where: { ...where, status: 'completed' }, _sum: { totalAmount: true } }),
      prisma.order.aggregate({
        where: {
          orgId: user.orgId,
          status: 'completed',
          createdAt: { gte: getVnDayStartUtc() },
        },
        _sum: { totalAmount: true },
      }),
    ]);

    return {
      totalOrders: total,
      completedOrders: completed,
      totalRevenue: revenue._sum.totalAmount || 0,
      todayRevenue: todayRevenue._sum.totalAmount || 0,
    };
  });

  // ── Staff performance ─────────────────────────────────────────────────────
  app.get('/api/v1/orders/by-staff', async (request: FastifyRequest) => {
    const user = request.user!;

    const staffStats = await prisma.order.groupBy({
      by: ['createdByUserId'],
      where: { orgId: user.orgId },
      _count: true,
      _sum: { totalAmount: true },
    });

    const userIds = staffStats
      .map((s) => s.createdByUserId)
      .filter((id): id is string => Boolean(id));
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, fullName: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u.fullName]));

    const result = staffStats.map((s) => ({
      userId: s.createdByUserId,
      fullName: s.createdByUserId ? (userMap.get(s.createdByUserId) || 'Unknown') : 'API Key / Machine',
      orderCount: s._count,
      totalRevenue: s._sum.totalAmount || 0,
    }));

    return { staffStats: result };
  });
}
