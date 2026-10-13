import type { PrismaClient } from "@prince/database";
import { accessibleBusinessIds } from "./access";
import { countPendingApprovals } from "./approvals";
import { startOfUtcDay, startOfUtcMonth, spendSince } from "./budget";

export interface OverviewFilters {
  businessId?: string;
  /** Number of trailing days for charts (default 14). */
  days?: number;
}

/**
 * Executive overview figures. Everything here is computed from records in Postgres
 * (data source: "actual" platform records). Financial metrics are not computed until the
 * Finance module records revenue and expenses, so the UI shows them as not yet tracked.
 */
export async function getOverview(db: PrismaClient, userId: string, filters: OverviewFilters = {}) {
  const allIds = await accessibleBusinessIds(db, userId);
  const businessIds = filters.businessId
    ? allIds.filter((id) => id === filters.businessId)
    : allIds;
  const days = Math.min(Math.max(filters.days ?? 14, 1), 90);
  const since = new Date(startOfUtcDay().getTime() - (days - 1) * 86_400_000);
  const scope = { businessId: { in: businessIds } };

  const [
    businesses,
    agents,
    runningRuns,
    queuedRuns,
    failedRuns,
    succeededRuns,
    recentRuns,
    recentFailures,
    runsInWindow,
    audit,
  ] = await Promise.all([
    db.business.count({ where: { id: { in: businessIds } } }),
    db.agent.count({
      where: { status: "active", OR: [{ businessId: null }, { businessId: { in: businessIds } }] },
    }),
    db.agentRun.count({ where: { ...scope, status: "running" } }),
    db.agentRun.count({ where: { ...scope, status: "queued" } }),
    db.agentRun.count({ where: { ...scope, status: "failed", queuedAt: { gte: since } } }),
    db.agentRun.count({ where: { ...scope, status: "succeeded", queuedAt: { gte: since } } }),
    db.agentRun.findMany({
      where: { ...scope, status: "succeeded" },
      orderBy: { finishedAt: "desc" },
      take: 5,
      include: { task: { select: { id: true, title: true } }, agent: { select: { name: true } } },
    }),
    db.agentRun.findMany({
      where: { ...scope, status: "failed" },
      orderBy: { finishedAt: "desc" },
      take: 5,
      include: { task: { select: { id: true, title: true } }, agent: { select: { name: true } } },
    }),
    db.agentRun.findMany({
      where: { ...scope, queuedAt: { gte: since } },
      select: {
        queuedAt: true,
        status: true,
        costUsd: true,
        inputTokens: true,
        outputTokens: true,
        providerLatencyMs: true,
        provider: true,
        agent: { select: { name: true } },
      },
    }),
    db.auditEvent.findMany({
      where: { OR: [{ businessId: { in: businessIds } }, { businessId: null, actorId: userId }] },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

  const series = Array.from({ length: days }, (_, i) => {
    const d = new Date(since.getTime() + i * 86_400_000);
    return {
      date: d.toISOString().slice(0, 10),
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      runs: 0,
      succeeded: 0,
      failed: 0,
    };
  });
  const costByAgent = new Map<string, number>();
  const latencies: number[] = [];
  let mockRuns = 0;
  for (const r of runsInWindow) {
    const bucket = series.find((s) => s.date === r.queuedAt.toISOString().slice(0, 10));
    const cost = Number(r.costUsd ?? 0);
    if (bucket) {
      bucket.costUsd += cost;
      bucket.inputTokens += r.inputTokens ?? 0;
      bucket.outputTokens += r.outputTokens ?? 0;
      bucket.runs += 1;
      if (r.status === "succeeded") bucket.succeeded += 1;
      if (r.status === "failed") bucket.failed += 1;
    }
    costByAgent.set(r.agent.name, (costByAgent.get(r.agent.name) ?? 0) + cost);
    if (r.providerLatencyMs != null) latencies.push(r.providerLatencyMs);
    if (r.provider === "mock") mockRuns += 1;
  }
  latencies.sort((a, b) => a - b);
  const pct = (p: number) =>
    latencies.length
      ? latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))]!
      : null;

  const [spendToday, spendMonth, pendingApprovals] = await Promise.all([
    spendSince(db, startOfUtcDay()),
    spendSince(db, startOfUtcMonth()),
    countPendingApprovals(db, businessIds),
  ]);

  return {
    days,
    counts: {
      businesses,
      activeAgents: agents,
      runningRuns,
      queuedRuns,
      failedRuns,
      succeededRuns,
      pendingApprovals,
      // Scheduled jobs arrive with workflows; reported as null (not tracked) rather than 0.
      scheduledTasks: null as number | null,
    },
    ai: {
      tokensIn: runsInWindow.reduce((n, r) => n + (r.inputTokens ?? 0), 0),
      tokensOut: runsInWindow.reduce((n, r) => n + (r.outputTokens ?? 0), 0),
      costUsd: runsInWindow.reduce((n, r) => n + Number(r.costUsd ?? 0), 0),
      spendTodayUsd: spendToday.actualUsd,
      spendMonthUsd: spendMonth.actualUsd,
      latencyP50Ms: pct(50),
      latencyP95Ms: pct(95),
      mockRuns,
      totalRuns: runsInWindow.length,
    },
    series,
    costByAgent: [...costByAgent.entries()]
      .map(([agent, costUsd]) => ({ agent, costUsd }))
      .sort((a, b) => b.costUsd - a.costUsd),
    recentRuns,
    recentFailures,
    audit,
  };
}

export async function listAuditEvents(
  db: PrismaClient,
  userId: string,
  opts: { take?: number } = {},
) {
  const businessIds = await accessibleBusinessIds(db, userId);
  return db.auditEvent.findMany({
    where: { OR: [{ businessId: { in: businessIds } }, { businessId: null, actorId: userId }] },
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.take ?? 100, 500),
  });
}
