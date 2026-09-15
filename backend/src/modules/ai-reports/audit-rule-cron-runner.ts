/**
 * audit-rule-cron-runner.ts — Minute-level scheduler for automated audit rules execution.
 */
import cron from 'node-cron';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { getAuditRules } from './ai-audit-rule-service.js';
import { evaluateAuditRule } from './ai-audit-evaluator.js';

let cronTask: ReturnType<typeof cron.schedule> | null = null;
const MAX_CONCURRENT_AUDITS = 3;

/**
 * Computes current time components strictly in Asia/Ho_Chi_Minh (UTC+7).
 */
export function getVietnamTimeComponents(now = new Date()): {
  timeStr: string;
  dateStr: string;
  dayOfWeek: number;
} {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  let year = '';
  let month = '';
  let day = '';
  let hour = '';
  let minute = '';
  for (const p of parts) {
    if (p.type === 'year') year = p.value;
    if (p.type === 'month') month = p.value;
    if (p.type === 'day') day = p.value;
    if (p.type === 'hour') hour = p.value;
    if (p.type === 'minute') minute = p.value;
  }

  const vnDate = new Date(`${year}-${month}-${day}T${hour}:${minute}:00+07:00`);
  const d = vnDate.getDay();
  const dayOfWeek = d === 0 ? 7 : d;

  return {
    timeStr: `${hour}:${minute}`,
    dateStr: `${year}-${month}-${day}`,
    dayOfWeek,
  };
}

/**
 * Checks all active organizations for due audit rules and executes them idempotently.
 */
export async function checkAndExecuteDueRules(now = new Date()): Promise<number> {
  const { timeStr, dateStr, dayOfWeek } = getVietnamTimeComponents(now);

  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true },
  });

  let executedCount = 0;

  for (const org of orgs) {
    try {
      const rules = await getAuditRules(org.id);
      const dueRules = rules.filter(
        (r) => r.isEnabled && r.runTime === timeStr && r.daysOfWeek.includes(dayOfWeek),
      );

      if (dueRules.length === 0) continue;

      // Process in chunks of MAX_CONCURRENT_AUDITS to prevent overwhelming resources
      for (let i = 0; i < dueRules.length; i += MAX_CONCURRENT_AUDITS) {
        const batch = dueRules.slice(i, i + MAX_CONCURRENT_AUDITS);

        await Promise.allSettled(
          batch.map(async (rule) => {
            const scheduleKey = `${org.id}:audit_rule:${rule.id}:${dateStr}-${timeStr.replace(':', '-')}`;

            // Distributed Idempotency Guard via transactional advisory lock
            const shouldRun = await prisma
              .$transaction(async (tx) => {
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scheduleKey}));`;
                const existing = await tx.aiReportJob.findUnique({
                  where: { scheduleKey },
                  select: { id: true },
                });
                return !existing;
              })
              .catch((lockErr) => {
                logger.warn(
                  { lockErr: lockErr?.message, scheduleKey },
                  '[audit-rule-cron] Advisory lock check failed',
                );
                return false;
              });

            if (!shouldRun) {
              logger.debug(
                { scheduleKey },
                '[audit-rule-cron] Rule already executed or in-progress, skipping',
              );
              return;
            }

            try {
              logger.info(
                `[audit-rule-cron] Executing scheduled audit rule "${rule.name}" (${rule.id}) for org ${org.name}`,
              );
              await evaluateAuditRule(org.id, rule, null, {
                isScheduled: true,
                scheduleKey,
              });
              executedCount++;
            } catch (ruleErr: any) {
              logger.error(
                `[audit-rule-cron] Error executing rule "${rule.name}" (${rule.id}): ${ruleErr?.message}`,
              );
            }
          }),
        );
      }
    } catch (orgErr: any) {
      logger.error(
        `[audit-rule-cron] Failed to process audit rules for org ${org.id}: ${orgErr?.message}`,
      );
    }
  }

  return executedCount;
}

/**
 * Start the minute-level cron runner for audit rules.
 */
export function startAuditRuleCron(): void {
  if (cronTask) {
    cronTask.stop();
  }

  cronTask = cron.schedule(
    '* * * * *',
    async () => {
      try {
        await checkAndExecuteDueRules();
      } catch (err: any) {
        logger.error(`[audit-rule-cron] Unhandled error during cron tick: ${err?.message}`);
      }
    },
    { timezone: 'Asia/Ho_Chi_Minh' },
  );

  logger.info('[audit-rule-cron] Scheduled audit rule cron runner initialized (* * * * * Asia/Ho_Chi_Minh)');
}

/**
 * Stop the audit rule cron runner.
 */
export function stopAuditRuleCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }
}
