/**
 * report-cron.ts — Background cron job scheduler for automated daily & weekly AI digests.
 */
import cron from 'node-cron';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { submitScheduledReportJob, type ReportJobRequest } from './report-job-service.js';

export interface AutomationSettings {
  dailyEnabled: boolean;
  weeklyEnabled: boolean;
  sendZalo: boolean;
  zaloDestinationType: 'self' | 'cloud' | 'uid';
  zaloTargetUid?: string;
  sendEmail: boolean;
  emailRecipients: string[];
}

const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
  dailyEnabled: true,
  weeklyEnabled: true,
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
      const { dailyCronTime: _dailyCronTime, weeklyCronTime: _weeklyCronTime, ...stored } = JSON.parse(setting.valuePlain);
      return { ...DEFAULT_AUTOMATION_SETTINGS, ...stored };
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

        const configuredGroups = await prisma.groupReportConfig.findMany({
          where: { orgId: org.id, isEnabled: true },
          select: { groupThreadId: true },
        });
        const groupThreadIds = configuredGroups.length > 0
          ? configuredGroups.map((group) => group.groupThreadId)
          : (await prisma.conversation.findMany({
              where: { orgId: org.id, threadType: 'group', externalThreadId: { not: null } },
              select: { externalThreadId: true },
            })).flatMap((conversation) => conversation.externalThreadId ? [conversation.externalThreadId] : []);

        if (groupThreadIds.length === 0) {
          logger.debug(`[report-cron] No groups to monitor for org ${org.name} (${org.id})`);
          continue;
        }
        if (groupThreadIds.length > 20 || new Set(groupThreadIds).size !== groupThreadIds.length) {
          logger.warn(`[report-cron] Skipping ${reportType} report for org ${org.id}: scheduled reports require 1-20 unique groups`);
          continue;
        }

        const request: ReportJobRequest = {
          fromDate: periodFrom.toISOString(), toDate: periodTo.toISOString(), groupThreadIds,
          title: `Báo Cáo Điều Hành ${reportType === 'daily' ? 'Ngày' : 'Tuần'} (${periodTo.toLocaleDateString('vi-VN')})`,
          reportType, sendZalo: settings.sendZalo, sendEmail: settings.sendEmail && settings.emailRecipients.length > 0,
          zaloDestinationType: settings.zaloDestinationType, zaloTargetUid: settings.zaloTargetUid,
          emailRecipients: settings.emailRecipients,
        };
        const scheduleKey = `${org.id}:${reportType}:${periodFrom.toISOString().slice(0, 10)}`;
        const { job, replay } = await submitScheduledReportJob(org.id, scheduleKey, request);
        logger.info(`[report-cron] ${replay ? 'Reused' : 'Queued'} scheduled ${reportType} job ${job.id} for org ${org.name}`);
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
