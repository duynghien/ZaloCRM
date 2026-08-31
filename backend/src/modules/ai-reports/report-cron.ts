/**
 * report-cron.ts — Background cron job scheduler for automated daily & weekly AI digests.
 */
import cron from 'node-cron';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { generateDigestReport } from './summarizer-service.js';
import { sendReportToZalo } from './zalo-report-sender.js';
import { sendReportEmail } from './email-service.js';

export interface AutomationSettings {
  dailyEnabled: boolean;
  dailyCronTime?: string; // default "0 18 * * *"
  weeklyEnabled: boolean;
  weeklyCronTime?: string; // default "0 17 * * 6"
  sendZalo: boolean;
  zaloDestinationType: 'self' | 'cloud' | 'uid';
  zaloTargetUid?: string;
  sendEmail: boolean;
  emailRecipients: string[];
}

const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
  dailyEnabled: true,
  dailyCronTime: '0 18 * * *',
  weeklyEnabled: true,
  weeklyCronTime: '0 17 * * 6',
  sendZalo: true,
  zaloDestinationType: 'self',
  sendEmail: false,
  emailRecipients: [],
};

/**
 * Read organization automation settings
 */
export async function getOrgAutomationSettings(orgId: string): Promise<AutomationSettings> {
  try {
    const setting = await prisma.appSetting.findUnique({
      where: {
        orgId_settingKey: {
          orgId,
          settingKey: 'ai_report_automation_settings',
        },
      },
    });

    if (setting?.valuePlain) {
      return { ...DEFAULT_AUTOMATION_SETTINGS, ...JSON.parse(setting.valuePlain) };
    }
  } catch (err) {
    logger.warn(`[report-cron] Failed to read automation settings for org ${orgId}:`, err);
  }

  return DEFAULT_AUTOMATION_SETTINGS;
}

/**
 * Execute automated report generation and dispatching for all eligible organizations
 */
export async function runScheduledOrgReports(
  reportType: 'daily' | 'weekly',
  periodFrom: Date,
  periodTo: Date,
): Promise<void> {
  logger.info(`[report-cron] Starting automated ${reportType} digest cycle...`);

  try {
    const orgs = await prisma.organization.findMany({
      select: { id: true, name: true },
    });

    for (const org of orgs) {
      try {
        const settings = await getOrgAutomationSettings(org.id);

        if (reportType === 'daily' && !settings.dailyEnabled) {
          logger.debug(`[report-cron] Daily digest disabled for org ${org.name} (${org.id})`);
          continue;
        }

        if (reportType === 'weekly' && !settings.weeklyEnabled) {
          logger.debug(`[report-cron] Weekly digest disabled for org ${org.name} (${org.id})`);
          continue;
        }

        // Check if there are any configured/enabled groups for this org
        const groupCount = await prisma.groupReportConfig.count({
          where: { orgId: org.id, isEnabled: true },
        });

        const convCount = await prisma.conversation.count({
          where: { orgId: org.id, threadType: 'group' },
        });

        if (groupCount === 0 && convCount === 0) {
          logger.debug(`[report-cron] No groups to monitor for org ${org.name} (${org.id})`);
          continue;
        }

        logger.info(`[report-cron] Generating scheduled ${reportType} report for org ${org.name}...`);

        const { report } = await generateDigestReport({
          orgId: org.id,
          reportType,
          periodFrom,
          periodTo,
          title: `Báo Cáo Điều Hành ${reportType === 'daily' ? 'Ngày' : 'Tuần'} (${periodTo.toLocaleDateString('vi-VN')})`,
        });

        let sentZalo = false;
        let sentEmail = false;

        // 1. Dispatch Zalo
        if (settings.sendZalo) {
          try {
            const zaloRes = await sendReportToZalo({
              orgId: org.id,
              destinationType: settings.zaloDestinationType,
              targetUid: settings.zaloTargetUid,
              markdownContent: report.summaryContent,
              reportTitle: report.title,
            });
            sentZalo = zaloRes.success;
          } catch (zaloErr) {
            logger.error(`[report-cron] Zalo dispatch failed for org ${org.id}:`, zaloErr);
          }
        }

        // 2. Dispatch Email
        if (settings.sendEmail && settings.emailRecipients.length > 0) {
          try {
            const emailRes = await sendReportEmail({
              orgId: org.id,
              toEmail: settings.emailRecipients,
              reportTitle: report.title,
              markdownContent: report.summaryContent,
              periodText: `Thời gian: ${periodFrom.toLocaleDateString('vi-VN')} - ${periodTo.toLocaleDateString('vi-VN')}`,
            });
            sentEmail = emailRes.success;
          } catch (emailErr) {
            logger.error(`[report-cron] Email dispatch failed for org ${org.id}:`, emailErr);
          }
        }

        // Update report status in DB
        await prisma.generatedReport.update({
          where: { id: report.id },
          data: { sentZalo, sentEmail },
        });

        logger.info(`[report-cron] Completed ${reportType} digest for org ${org.name} (Zalo: ${sentZalo}, Email: ${sentEmail})`);
      } catch (orgErr: any) {
        logger.error(`[report-cron] Error running report for org ${org.id}:`, orgErr?.message || orgErr);
      }
    }
  } catch (err: any) {
    logger.error('[report-cron] Global scheduled report job error:', err?.message || err);
  }
}

/**
 * Start cron jobs for daily & weekly reports
 */
export function startReportCronJobs(): void {
  // 1. Daily Job: 18:00 every day (Vietnam Time UTC+7)
  cron.schedule(
    '0 18 * * *',
    async () => {
      logger.info('[report-cron] Triggering daily 18:00 report cron (Asia/Ho_Chi_Minh)...');
      const now = new Date();
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);

      await runScheduledOrgReports('daily', startOfDay, now);
    },
    { timezone: 'Asia/Ho_Chi_Minh' },
  );

  // 2. Weekly Job: 17:00 every Saturday (day 6) (Vietnam Time UTC+7)
  cron.schedule(
    '0 17 * * 6',
    async () => {
      logger.info('[report-cron] Triggering weekly Saturday 17:00 report cron (Asia/Ho_Chi_Minh)...');
      const now = new Date();
      const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      await runScheduledOrgReports('weekly', startOfWeek, now);
    },
    { timezone: 'Asia/Ho_Chi_Minh' },
  );

  logger.info('[report-cron] AI Report cron jobs initialized (Daily 18:00, Weekly Sat 17:00 in Asia/Ho_Chi_Minh)');
}
