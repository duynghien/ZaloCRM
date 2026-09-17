import { prisma } from '../../shared/database/prisma-client.js';
import { getOrgAiProviderCredentials } from './ai-provider-settings-service.js';

export interface BudgetAlertStatus {
  status: 'ok' | 'warning' | 'exceeded';
  currentCostVnd: number;
  monthlyBudgetVnd: number;
  usagePercentage: number;
}

export function getVnMonthStartDate(now: Date = new Date()): Date {
  const vnTime = new Date(now.getTime() + 7 * 3600 * 1000);
  const vnYear = vnTime.getUTCFullYear();
  const vnMonth = vnTime.getUTCMonth();
  return new Date(Date.UTC(vnYear, vnMonth, 1, 0, 0, 0, 0));
}

export async function getAiBudgetStatus(
  orgId: string,
  client = prisma,
): Promise<BudgetAlertStatus> {
  const settings = await getOrgAiProviderCredentials(orgId);
  const budget = Number(settings.monthlyBudgetVnd) || 0;

  const startOfMonth = getVnMonthStartDate();

  const aggregate = await client.dailyAiUsageStat.aggregate({
    where: {
      orgId,
      statDate: {
        gte: startOfMonth,
      },
    },
    _sum: {
      costVnd: true,
    },
  });

  const currentCostVnd = Number(aggregate._sum.costVnd ?? 0n);

  if (budget <= 0) {
    return {
      status: 'ok',
      currentCostVnd,
      monthlyBudgetVnd: 0,
      usagePercentage: 0,
    };
  }

  const usagePercentage = Math.round((currentCostVnd / budget) * 100);
  let status: 'ok' | 'warning' | 'exceeded' = 'ok';

  if (usagePercentage >= 100) {
    status = 'exceeded';
  } else if (usagePercentage >= 80) {
    status = 'warning';
  }

  return {
    status,
    currentCostVnd,
    monthlyBudgetVnd: budget,
    usagePercentage,
  };
}
