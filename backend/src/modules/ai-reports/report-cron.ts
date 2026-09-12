/**
 * report-cron.ts — Background cron job scheduler for automated daily & weekly AI digests.
 */
import cron from 'node-cron';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { submitScheduledReportJob, normalizeReportJobRequest } from './report-job-service.js';

import { assertReportAdmission, trackReportProducer, drainReportProducers } from './report-admission.js';

let reportCronTasks: ReturnType<typeof cron.schedule>[] = [];

export interface AutomationSettings {
  dailyEnabled: boolean;
  weeklyEnabled: boolean;
  sendZalo: boolean;
  zaloDestinationType: 'self' | 'cloud' | 'uid';
  zaloTargetUid?: string;
  senderAccountId?: string;
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
    throw err;
  }

  return DEFAULT_AUTOMATION_SETTINGS;
}

/**
 * Execute automated report generation and dispatching for all eligible organizations
 */
async function executeScheduledOrgReports(
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

        assertReportAdmission();
        const configs = await prisma.groupReportConfig.findMany({ where: { orgId: org.id } });
        if (configs.some(c => c.targetResolutionStatus !== 'resolved')) throw new Error('Report configurations need source resolution');
        const pairs = configs.length
          ? configs.filter(c => c.isEnabled).map(c => ({ zalo_account_id: c.zaloAccountId!, group_thread_id: c.groupThreadId }))
          : (await prisma.conversation.findMany({ where: { orgId: org.id, threadType: 'group', externalThreadId: { not: null }, zaloAccount: { orgId: org.id } }, select: { zaloAccountId: true, externalThreadId: true } })).map(c => ({ zalo_account_id: c.zaloAccountId, group_thread_id: c.externalThreadId! }));
        if (!pairs.length) continue;
        const request = normalizeReportJobRequest({
          from_date: periodFrom.toISOString(), to_date: periodTo.toISOString(), group_targets: pairs,
          title: `Báo Cáo Điều Hành ${reportType === 'daily' ? 'Ngày' : 'Tuần'} (${periodTo.toLocaleDateString('vi-VN')})`,
          report_type: reportType, send_zalo: settings.sendZalo, send_email: settings.sendEmail,
          zalo_account_id: settings.senderAccountId, zalo_destination_type: settings.zaloDestinationType,
          zalo_target_uid: settings.zaloTargetUid, email_recipients: settings.emailRecipients,
        });
        if (request.sendEmail && !request.emailRecipients.length) throw new Error('Scheduled email requires recipients');
        assertReportAdmission();
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

export function runScheduledOrgReports(reportType: 'daily' | 'weekly', periodFrom: Date, periodTo: Date): Promise<void> {
  return trackReportProducer(() => executeScheduledOrgReports(reportType, periodFrom, periodTo));
}

/**
 * Start cron jobs for daily & weekly reports
 */
export function startReportCronJobs(): void {
  for (const task of reportCronTasks) task.stop();
  reportCronTasks = [];
  // 1. Daily Job: 18:00 every day (Vietnam Time UTC+7)
  reportCronTasks.push(cron.schedule(
    '0 18 * * *',
    async () => {
      logger.info('[report-cron] Triggering daily 18:00 report cron (Asia/Ho_Chi_Minh)...');
      const now = new Date();
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);

      await runScheduledOrgReports('daily', startOfDay, now);
    },
    { timezone: 'Asia/Ho_Chi_Minh' },
  ));

  // 2. Weekly Job: 17:00 every Saturday (day 6) (Vietnam Time UTC+7)
  reportCronTasks.push(cron.schedule(
    '0 17 * * 6',
    async () => {
      logger.info('[report-cron] Triggering weekly Saturday 17:00 report cron (Asia/Ho_Chi_Minh)...');
      const now = new Date();
      const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      await runScheduledOrgReports('weekly', startOfWeek, now);
    },
    { timezone: 'Asia/Ho_Chi_Minh' },
  ));

  logger.info('[report-cron] AI Report cron jobs initialized (Daily 18:00, Weekly Sat 17:00 in Asia/Ho_Chi_Minh)');
}

export async function stopReportCronJobs(): Promise<void> {
  for (const task of reportCronTasks) task.stop();
  reportCronTasks = [];
  await drainReportProducers();
}
