import type { Prisma, PrismaClient } from "@prince/database";

export interface BudgetLimits {
  dailyUsd: number;
  monthlyUsd: number;
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Arbitrary constant key for the Postgres advisory lock that serialises budget reservations.
 * Every worker takes it before reading committed spend and writing a reservation, so two runs
 * starting at the same moment cannot both fit under a limit that only has room for one.
 */
export const BUDGET_LOCK_KEY = 72_610_513_001;

export function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function startOfUtcMonth(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export interface SpendTotals {
  /** Cost already incurred (provider-reported usage, plus worst-case estimates for aborted calls). */
  actualUsd: number;
  /** Worst-case cost held by attempts that are in flight right now. */
  reservedUsd: number;
}

/** Spend attributed to runs that started on or after `since`. */
export async function spendSince(db: Db, since: Date): Promise<SpendTotals> {
  const agg = await db.agentRun.aggregate({
    where: { startedAt: { gte: since } },
    _sum: { costUsd: true, reservedUsd: true },
  });
  return {
    actualUsd: Number(agg._sum.costUsd ?? 0),
    reservedUsd: Number(agg._sum.reservedUsd ?? 0),
  };
}

export interface BudgetWindow {
  limitUsd: number;
  actualUsd: number;
  reservedUsd: number;
  /** actual + reserved: what counts against the limit. */
  committedUsd: number;
  remainingUsd: number;
  reached: boolean;
}

export interface BudgetStatus {
  day: BudgetWindow;
  month: BudgetWindow;
  /** True when either window has no room left for new paid runs. */
  blocked: boolean;
}

function window(limitUsd: number, t: SpendTotals): BudgetWindow {
  const committedUsd = t.actualUsd + t.reservedUsd;
  const remainingUsd = Math.max(0, limitUsd - committedUsd);
  return { limitUsd, ...t, committedUsd, remainingUsd, reached: remainingUsd <= 0 };
}

export async function getBudgetStatus(
  db: Db,
  limits: BudgetLimits,
  now = new Date(),
): Promise<BudgetStatus> {
  const [day, month] = await Promise.all([
    spendSince(db, startOfUtcDay(now)),
    spendSince(db, startOfUtcMonth(now)),
  ]);
  const d = window(limits.dailyUsd, day);
  const m = window(limits.monthlyUsd, month);
  return { day: d, month: m, blocked: d.reached || m.reached };
}

export type BudgetCheck = { ok: true } | { ok: false; reason: string };

function fits(status: BudgetStatus, projectedUsd: number): BudgetCheck {
  const { day, month } = status;
  if (day.committedUsd + projectedUsd > day.limitUsd) {
    return {
      ok: false,
      reason: `Daily AI budget would be exceeded ($${day.actualUsd.toFixed(4)} spent and $${day.reservedUsd.toFixed(4)} reserved by running work, of $${day.limitUsd}; this run could cost up to $${projectedUsd.toFixed(4)})`,
    };
  }
  if (month.committedUsd + projectedUsd > month.limitUsd) {
    return {
      ok: false,
      reason: `Monthly AI budget would be exceeded ($${month.actualUsd.toFixed(4)} spent and $${month.reservedUsd.toFixed(4)} reserved, of $${month.limitUsd}; this run could cost up to $${projectedUsd.toFixed(4)})`,
    };
  }
  return { ok: true };
}

/** Non-locking check, used to refuse a request early. The authoritative check is reserveBudget. */
export async function checkGlobalBudget(
  db: Db,
  limits: BudgetLimits,
  projectedUsd: number,
  now = new Date(),
): Promise<BudgetCheck> {
  return fits(await getBudgetStatus(db, limits, now), projectedUsd);
}

/**
 * Atomically checks the global limits and, if the run fits, marks it running with a reservation
 * of its worst-case cost. Must be the only way an attempt moves to "running" for a paid provider.
 */
export async function reserveBudget(
  db: PrismaClient,
  limits: BudgetLimits,
  runId: string,
  projectedUsd: number,
  data: Prisma.AgentRunUpdateInput,
  now = new Date(),
): Promise<BudgetCheck> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BUDGET_LOCK_KEY}::bigint)`;
    const check = fits(await getBudgetStatus(tx, limits, now), projectedUsd);
    if (!check.ok) return check;
    await tx.agentRun.update({
      where: { id: runId },
      data: { ...data, status: "running", startedAt: now, reservedUsd: projectedUsd },
    });
    return check;
  });
}
