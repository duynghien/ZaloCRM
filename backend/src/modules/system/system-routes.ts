import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';

export async function systemRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  /**
   * Reset active cron leases immediately.
   * Restricted to admin and owner roles.
   */
  app.post('/api/v1/system/cron-leases/reset', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { role: string; orgId: string };
    if (!['owner', 'admin'].includes(user.role)) {
      return reply.status(403).send({ error: 'Không có quyền truy cập quản trị hệ thống' });
    }

    const body = (request.body || {}) as { lockId?: number | string };
    try {
      if (body.lockId !== undefined && body.lockId !== null) {
        const lockIdBigInt = BigInt(body.lockId);
        await prisma.$executeRaw`
          UPDATE "cron_job_leases"
          SET "lease_owner" = NULL, "lease_expires_at" = NULL, "updated_at" = NOW()
          WHERE "lock_id" = ${lockIdBigInt}
        `;
        logger.info({ lockId: body.lockId }, '[system] Admin reset specific cron lease');
      } else {
        await prisma.$executeRaw`
          UPDATE "cron_job_leases"
          SET "lease_owner" = NULL, "lease_expires_at" = NULL, "updated_at" = NOW()
        `;
        logger.info('[system] Admin reset all cron leases');
      }

      return { success: true, message: 'Đã thiết lập lại khóa cron lease thành công' };
    } catch (err: any) {
      logger.error('[system] Failed to reset cron lease:', err);
      return reply.status(500).send({ error: 'Không thể thiết lập lại khóa cron lease', details: err?.message });
    }
  });
}
