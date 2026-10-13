import { marketResearchSchema } from "@prince/agents";
import type { PrismaClient } from "@prince/database";
import { accessibleBusinessIds } from "../access";
import { financeSummary } from "./finance";

/**
 * Read-only views computed from records that already exist: Research Lab (saved research briefs),
 * Analytics (agents, workflows, finance, pipelines) and Calendar (dated records). Nothing here is
 * estimated or sample data; empty records produce empty views.
 */

async function scope(db: PrismaClient, userId: string, businessId?: string) {
  const all = await accessibleBusinessIds(db, userId);
  return businessId ? all.filter((id) => id === businessId) : all;
}

// ---------------------------------------------------------------------------
// Research Lab
// ---------------------------------------------------------------------------

export const RESEARCH_SCHEMA_KEY = "market-research.v1";

/** Succeeded runs of any agent whose version produces research briefs, newest first. */
export async function listResearch(
  db: PrismaClient,
  userId: string,
  opts: { businessId?: string; limit?: number } = {},
) {
  const businessIds = await scope(db, userId, opts.businessId);
  const versions = await db.agentVersion.findMany({
    where: { outputSchemaKey: RESEARCH_SCHEMA_KEY },
    select: { agentId: true, version: true },
  });
  if (versions.length === 0 || businessIds.length === 0) return [];
  const runs = await db.agentRun.findMany({
    where: {
      businessId: { in: businessIds },
      status: "succeeded",
      OR: versions.map((v) => ({ agentId: v.agentId, agentVersion: v.version })),
    },
    orderBy: { finishedAt: "desc" },
    take: Math.min(opts.limit ?? 50, 200),
    include: {
      task: { select: { id: true, title: true, subjectType: true, subjectId: true } },
      agent: { select: { name: true } },
      business: { select: { id: true, name: true } },
    },
  });
  return runs.map((r) => {
    const brief = marketResearchSchema.safeParse(r.output).data;
    return {
      runId: r.id,
      taskId: r.task.id,
      title: r.task.title,
      business: r.business,
      agentName: r.agent.name,
      provider: r.provider,
      finishedAt: r.finishedAt,
      costUsd: r.costUsd == null ? null : Number(r.costUsd),
      question: brief?.question ?? null,
      summary: brief?.summary ?? null,
      findings: brief?.findings.length ?? 0,
      needsVerification: brief?.findings.filter((f) => f.needsVerification).length ?? 0,
      opportunities: brief?.opportunities ?? [],
    };
  });
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export async function getAnalytics(
  db: PrismaClient,
  userId: string,
  opts: { businessId?: string; days?: number } = {},
) {
  const businessIds = await scope(db, userId, opts.businessId);
  const days = Math.min(Math.max(opts.days ?? 30, 1), 366);
  const now = new Date();
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const from = new Date(to.getTime() - days * 86_400_000);
  const inScope = { businessId: { in: businessIds } };

  const [runs, agents, workflowRuns, workflows, products, content, campaigns, backlog, businesses] =
    await Promise.all([
      db.agentRun.findMany({
        where: { ...inScope, queuedAt: { gte: from, lt: to } },
        select: {
          agentId: true,
          businessId: true,
          status: true,
          provider: true,
          costUsd: true,
          providerLatencyMs: true,
        },
      }),
      db.agent.findMany({ select: { id: true, name: true } }),
      db.workflowRun.findMany({
        where: { ...inScope, createdAt: { gte: from, lt: to } },
        select: { workflowId: true, status: true },
      }),
      db.workflow.findMany({ where: inScope, select: { id: true, name: true } }),
      db.product.groupBy({
        by: ["stage"],
        where: { ...inScope, archivedAt: null },
        _count: { _all: true },
      }),
      db.contentItem.groupBy({
        by: ["stage"],
        where: { ...inScope, archivedAt: null },
        _count: { _all: true },
      }),
      db.campaign.groupBy({
        by: ["status"],
        where: { ...inScope, archivedAt: null },
        _count: { _all: true },
      }),
      db.backlogItem.groupBy({
        by: ["status"],
        where: { project: { ...inScope, archivedAt: null } },
        _count: { _all: true },
      }),
      db.business.findMany({
        where: { id: { in: businessIds } },
        select: { id: true, name: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);

  const agentName = new Map(agents.map((a) => [a.id, a.name]));
  const byAgent = new Map<string, typeof runs>();
  for (const r of runs) byAgent.set(r.agentId, [...(byAgent.get(r.agentId) ?? []), r]);
  const agentUtilization = [...byAgent.entries()]
    .map(([agentId, rs]) => {
      const finished = rs.filter((r) => r.status === "succeeded" || r.status === "failed");
      const latencies = rs.map((r) => r.providerLatencyMs).filter((n): n is number => n != null);
      return {
        agentId,
        agent: agentName.get(agentId) ?? "Unknown agent",
        runs: rs.length,
        succeeded: rs.filter((r) => r.status === "succeeded").length,
        failed: rs.filter((r) => r.status === "failed").length,
        mockRuns: rs.filter((r) => r.provider === "mock").length,
        successRate: finished.length
          ? finished.filter((r) => r.status === "succeeded").length / finished.length
          : null,
        costUsd: rs.reduce((n, r) => n + Number(r.costUsd ?? 0), 0),
        avgLatencyMs: latencies.length
          ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
          : null,
      };
    })
    .sort((a, b) => b.runs - a.runs);

  const workflowName = new Map(workflows.map((w) => [w.id, w.name]));
  const byWorkflow = new Map<string, typeof workflowRuns>();
  for (const r of workflowRuns)
    byWorkflow.set(r.workflowId, [...(byWorkflow.get(r.workflowId) ?? []), r]);
  const workflowStats = [...byWorkflow.entries()]
    .map(([workflowId, rs]) => {
      const finished = rs.filter((r) => r.status === "succeeded" || r.status === "failed");
      return {
        workflowId,
        workflow: workflowName.get(workflowId) ?? "Unknown workflow",
        runs: rs.length,
        succeeded: rs.filter((r) => r.status === "succeeded").length,
        failed: rs.filter((r) => r.status === "failed").length,
        inProgress: rs.filter((r) => r.status === "running" || r.status === "waiting_approval")
          .length,
        successRate: finished.length
          ? finished.filter((r) => r.status === "succeeded").length / finished.length
          : null,
      };
    })
    .sort((a, b) => b.runs - a.runs);

  const perBusiness = await Promise.all(
    businesses.map(async (b) => {
      const s = await financeSummary(db, [b.id], { from, to });
      const rs = runs.filter((r) => r.businessId === b.id);
      return {
        businessId: b.id,
        business: b.name,
        runs: rs.length,
        aiCostUsd: s.expenses.ai,
        hasRevenue: s.hasRevenue,
        netRevenue: s.netRevenue,
        operatingExpenses: s.operatingExpenses,
        netProfit: s.netProfit,
        financeEntries: s.entryCount,
      };
    }),
  );

  // Monthly profit and loss for the last six calendar months (UTC).
  const months = Array.from({ length: 6 }, (_, i) => {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + i, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    return { label: start.toISOString().slice(0, 7), start, end };
  });
  const monthly = await Promise.all(
    months.map(async (m) => {
      const s = await financeSummary(db, businessIds, { from: m.start, to: m.end });
      return {
        month: m.label,
        netRevenue: s.netRevenue,
        expenses: Math.round((s.cogs + s.operatingExpenses) * 100) / 100,
        netProfit: s.netProfit,
        entries: s.entryCount,
      };
    }),
  );

  const counts = <K extends string>(
    rows: ({ _count: { _all: number } } & Record<string, unknown>)[],
    key: K,
  ) =>
    Object.fromEntries(rows.map((r) => [String(r[key]), r._count._all])) as Record<string, number>;

  return {
    days,
    from,
    to,
    totals: {
      runs: runs.length,
      costUsd: runs.reduce((n, r) => n + Number(r.costUsd ?? 0), 0),
      workflowRuns: workflowRuns.length,
    },
    agentUtilization,
    workflowStats,
    perBusiness,
    monthly,
    pipelines: {
      products: counts(products, "stage"),
      content: counts(content, "stage"),
      campaigns: counts(campaigns, "status"),
      backlog: counts(backlog, "status"),
    },
  };
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export interface CalendarEvent {
  date: string;
  kind: "content" | "campaign_start" | "campaign_end" | "approval_expiry" | "workflow_run";
  title: string;
  href: string;
  business: string;
  status: string;
}

/** Dated records in a calendar month (YYYY-MM, UTC). Recurring schedules do not exist yet. */
export async function getCalendar(
  db: PrismaClient,
  userId: string,
  opts: { month?: string; businessId?: string } = {},
) {
  const businessIds = await scope(db, userId, opts.businessId);
  const now = new Date();
  const m = /^(\d{4})-(\d{2})$/.exec(opts.month ?? "");
  const year = m ? Number(m[1]) : now.getUTCFullYear();
  const month = m ? Number(m[2]) - 1 : now.getUTCMonth();
  const start = new Date(Date.UTC(year, Math.min(Math.max(month, 0), 11), 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const inScope = { businessId: { in: businessIds } };
  const range = { gte: start, lt: end };
  const biz = { business: { select: { name: true } } } as const;

  const [content, starts, ends, approvals, workflowRuns] = await Promise.all([
    db.contentItem.findMany({
      where: { ...inScope, archivedAt: null, scheduledFor: range },
      include: biz,
    }),
    db.campaign.findMany({
      where: { ...inScope, archivedAt: null, startsOn: range },
      include: biz,
    }),
    db.campaign.findMany({ where: { ...inScope, archivedAt: null, endsOn: range }, include: biz }),
    db.approvalRequest.findMany({
      where: { ...inScope, status: "pending", expiresAt: range },
      include: biz,
    }),
    db.workflowRun.findMany({
      where: { ...inScope, createdAt: range },
      include: { ...biz, workflow: { select: { name: true } } },
    }),
  ]);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const events: CalendarEvent[] = [
    ...content.map((c) => ({
      date: day(c.scheduledFor!),
      kind: "content" as const,
      title: `Publish: ${c.title}`,
      href: `/content/${c.id}`,
      business: c.business.name,
      status: c.stage,
    })),
    ...starts.map((c) => ({
      date: day(c.startsOn!),
      kind: "campaign_start" as const,
      title: `Campaign starts: ${c.name}`,
      href: `/marketing/${c.id}`,
      business: c.business.name,
      status: c.status,
    })),
    ...ends.map((c) => ({
      date: day(c.endsOn!),
      kind: "campaign_end" as const,
      title: `Campaign ends: ${c.name}`,
      href: `/marketing/${c.id}`,
      business: c.business.name,
      status: c.status,
    })),
    ...approvals.map((a) => ({
      date: day(a.expiresAt),
      kind: "approval_expiry" as const,
      title: `Approval expires: ${a.title}`,
      href: `/approvals/${a.id}`,
      business: a.business.name,
      status: a.status,
    })),
    ...workflowRuns.map((r) => ({
      date: day(r.createdAt),
      kind: "workflow_run" as const,
      title: `Workflow run: ${r.workflow.name}`,
      href: `/workflows/runs/${r.id}`,
      business: r.business.name,
      status: r.status,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));

  const prev = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
  return {
    month: start.toISOString().slice(0, 7),
    previous: prev.toISOString().slice(0, 7),
    next: end.toISOString().slice(0, 7),
    start,
    end,
    events,
  };
}
