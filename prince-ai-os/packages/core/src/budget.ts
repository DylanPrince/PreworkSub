import type { PrismaClient } from "@prince/database";

export interface BudgetLimits {
  dailyUsd: number;
  monthlyUsd: number;
}

export async function spendSince(db: PrismaClient, since: Date): Promise<number> {
  const agg = await db.agentRun.aggregate({
    where: { queuedAt: { gte: since }, costUsd: { not: null } },
    _sum: { costUsd: true },
  });
  return Number(agg._sum.costUsd ?? 0);
}

export function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function startOfUtcMonth(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export type BudgetCheck = { ok: true } | { ok: false; reason: string };

/**
 * Hard spending limits checked before every provider call. `projectedUsd` is the worst-case cost
 * of the run about to start (estimated input + the agent's max output tokens).
 */
export async function checkGlobalBudget(
  db: PrismaClient,
  limits: BudgetLimits,
  projectedUsd: number,
  now = new Date(),
): Promise<BudgetCheck> {
  const [day, month] = await Promise.all([
    spendSince(db, startOfUtcDay(now)),
    spendSince(db, startOfUtcMonth(now)),
  ]);
  if (day + projectedUsd > limits.dailyUsd) {
    return {
      ok: false,
      reason: `Daily AI budget would be exceeded ($${day.toFixed(4)} spent of $${limits.dailyUsd}, run could cost up to $${projectedUsd.toFixed(4)})`,
    };
  }
  if (month + projectedUsd > limits.monthlyUsd) {
    return {
      ok: false,
      reason: `Monthly AI budget would be exceeded ($${month.toFixed(4)} spent of $${limits.monthlyUsd})`,
    };
  }
  return { ok: true };
}
