/**
 * ai-report-archive-routes.ts — Endpoints for viewing generated report archive, detail, PDF export, and re-dispatch.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../shared/database/prisma-client.js';
import { generateReportPdfBuffer } from '../report-pdf-service.js';
import { boundedPositiveInt } from '../../../shared/http/request-bounds.js';
import { assertReportAdmission } from '../report-admission.js';
import { resendReport } from '../report-resend-service.js';
import { isOrganizationAdministrator, canAccessReport } from './ai-report-route-helpers.js';

interface ResendBody {
  send_zalo?: boolean;
  send_email?: boolean;
  zalo_destination_type?: 'self' | 'cloud' | 'uid';
  zalo_target_uid?: string;
  email_recipients?: string[];
}

export async function aiReportArchiveRoutes(app: FastifyInstance) {
  // ── 1. List Generated Reports Archive (paginated) ───────────────────────────
  app.get('/api/v1/ai-reports', async (request: FastifyRequest) => {
    const user = request.user!;
    const {
      page = '1',
      limit = '20',
      report_type,
    } = request.query as { page?: string; limit?: string; report_type?: string };

    const where: any = { orgId: user.orgId };
    if (report_type) {
      where.reportType = report_type;
    }

    const pageNum = boundedPositiveInt(page, 1, 10_000);
    const limitNum = boundedPositiveInt(limit, 20, 100);

    const [allReports, total] = await Promise.all([
      prisma.generatedReport.findMany({
        where,
        include: {
          createdBy: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.generatedReport.count({ where }),
    ]);

    const allowedReports = isOrganizationAdministrator(user)
      ? allReports
      : (await Promise.all(allReports.map(async (report) => ({ report, allowed: await canAccessReport(user, report) }))))
        .filter(({ allowed }) => allowed)
        .map(({ report }) => report);
    const reports = allowedReports.slice((pageNum - 1) * limitNum, pageNum * limitNum);
    const accessibleTotal = isOrganizationAdministrator(user) ? total : allowedReports.length;

    return {
      reports,
      total: accessibleTotal,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(accessibleTotal / limitNum),
    };
  });

  // ── 2. Get Report Details ───────────────────────────────────────────────────
  app.get('/api/v1/ai-reports/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const report = await prisma.generatedReport.findFirst({
      where: { id, orgId: user.orgId },
      include: {
        createdBy: { select: { id: true, fullName: true, email: true } },
      },
    });

    if (!report) {
      return reply.status(404).send({ error: 'Report not found' });
    }
    if (!(await canAccessReport(user, report))) {
      return reply.status(404).send({ error: 'Report not found' });
    }

    return { report };
  });

  // ── 3. Download Report PDF ──────────────────────────────────────────────────
  app.get('/api/v1/ai-reports/:id/pdf', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const report = await prisma.generatedReport.findFirst({
      where: { id, orgId: user.orgId },
      include: {
        createdBy: { select: { id: true, fullName: true, email: true } },
      },
    });

    if (!report || !(await canAccessReport(user, report))) {
      return reply.status(404).send({ error: 'Report not found' });
    }

    const fromStr = report.periodFrom.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const toStr = report.periodTo.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const buffer = await generateReportPdfBuffer(report.title, report.summaryContent, {
      authorName: report.createdBy?.fullName || undefined,
      reportType: report.reportType,
      periodText: `${fromStr} — ${toStr}`,
    });

    const dateSlug = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const cleanTitleSlug = report.title
      .toLowerCase()
      .replace(/[đ]/g, 'd')
      .replace(/[Đ]/g, 'd')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'bao-cao-dieu-hanh';

    const filename = `${cleanTitleSlug}-${dateSlug}.pdf`;

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return reply.send(buffer);
  });

  // ── 4. Resend Report to Zalo or Email ───────────────────────────────────────
  app.post('/api/v1/ai-reports/:id/resend', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as ResendBody;

    const report = await prisma.generatedReport.findFirst({
      where: { id, orgId: user.orgId },
    });

    if (!report) {
      return reply.status(404).send({ error: 'Report not found' });
    }
    if (!(await canAccessReport(user, report, 'chat'))) {
      return reply.status(404).send({ error: 'Report not found' });
    }

    assertReportAdmission();
    const key = request.headers['idempotency-key'];
    return resendReport(user, report, body as Record<string, unknown>, typeof key === 'string' ? key : '');
  });
}
