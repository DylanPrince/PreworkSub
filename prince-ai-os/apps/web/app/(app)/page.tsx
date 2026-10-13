import {
  AlertTriangle,
  Bot,
  Briefcase,
  CheckCircle2,
  Clock,
  DollarSign,
  Gauge,
  PlayCircle,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { getAiStatus, getOverview, listBusinesses, runPolicyFromEnv } from "@prince/core";
import { formatDuration, formatMoney, formatNumber, formatUsd } from "@prince/shared";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Stat } from "@/components/common/stat";
import { ProviderBadge } from "@/components/common/status-badge";
import {
  CostByAgentChart,
  CostChart,
  OutcomeChart,
  TokenChart,
} from "@/components/overview/charts";
import { OverviewFilters } from "@/components/overview/filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db, env } from "@/lib/server";
import { requireUser } from "@/lib/session";
import { relativeTime } from "@/lib/utils";

export const metadata = { title: "Overview" };

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ business?: string; days?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const [o, businesses, ai] = await Promise.all([
    getOverview(db, user.id, { businessId: sp.business || undefined, days: Number(sp.days) || 14 }),
    listBusinesses(db, user.id),
    getAiStatus(db, runPolicyFromEnv()),
  ]);

  const alerts: { tone: "warning" | "danger"; text: string; href?: string }[] = [];
  if (o.counts.pendingApprovals > 0)
    alerts.push({
      tone: "warning",
      text: `${o.counts.pendingApprovals} approval request(s) waiting for a decision.`,
      href: "/approvals",
    });
  if (ai.mode === "not_configured")
    alerts.push({
      tone: "warning",
      text: "Claude API key is not configured. Paid runs are refused until it is set; dry runs still work.",
    });
  if (ai.mode === "mock")
    alerts.push({
      tone: "warning",
      text: "Mock mode is the default. Runs produce labelled placeholder output, not real analysis.",
    });
  for (const [name, w] of [
    ["daily", ai.budget.day],
    ["monthly", ai.budget.month],
  ] as const) {
    if (w.reached)
      alerts.push({
        tone: "danger",
        text: `The ${name} AI spending limit (${formatUsd(w.limitUsd)}) is reached. New paid runs are refused.`,
      });
    else if (w.committedUsd >= w.limitUsd * 0.8)
      alerts.push({
        tone: "warning",
        text: `AI spend is ${formatUsd(w.committedUsd)} of the ${formatUsd(w.limitUsd)} ${name} limit.`,
      });
  }
  if (o.counts.failedRuns > 0)
    alerts.push({
      tone: "warning",
      text: `${o.counts.failedRuns} failed run(s) in the selected period.`,
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description="Live figures computed from platform records. Nothing here is sample data."
        actions={
          <Suspense>
            <OverviewFilters businesses={businesses.map((b) => ({ id: b.id, name: b.name }))} />
          </Suspense>
        }
      />

      {businesses.length === 0 && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-5">
            <div>
              <p className="text-sm font-medium">Start by creating a business workspace</p>
              <p className="text-xs text-muted-foreground">
                Agents, tasks and costs are always scoped to a business.
              </p>
            </div>
            <Button asChild>
              <Link href="/businesses/new">Create business</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {alerts.length > 0 && (
        <ul aria-label="Alerts" className="space-y-2">
          {alerts.map((a) => (
            <li
              key={a.text}
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${a.tone === "danger" ? "border-danger/40 bg-danger-soft text-danger" : "border-warning/40 bg-warning-soft text-warning"}`}
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {a.href ? (
                <Link href={a.href} className="underline-offset-2 hover:underline">
                  {a.text}
                </Link>
              ) : (
                a.text
              )}
            </li>
          ))}
        </ul>
      )}

      <section
        aria-label="Operations"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <Stat
          label="Active businesses"
          value={formatNumber(o.counts.businesses)}
          icon={<Briefcase className="size-3.5" />}
        />
        <Stat
          label="Active agents"
          value={formatNumber(o.counts.activeAgents)}
          icon={<Bot className="size-3.5" />}
        />
        <Stat
          label="Running / queued runs"
          value={`${o.counts.runningRuns} / ${o.counts.queuedRuns}`}
          icon={<PlayCircle className="size-3.5" />}
        />
        <Stat
          label="Pending approvals"
          value={formatNumber(o.counts.pendingApprovals)}
          icon={<ShieldCheck className="size-3.5" />}
        />
        <Stat
          label={`Succeeded runs (${o.days}d)`}
          value={formatNumber(o.counts.succeededRuns)}
          icon={<CheckCircle2 className="size-3.5" />}
        />
        <Stat
          label={`Failed runs (${o.days}d)`}
          value={formatNumber(o.counts.failedRuns)}
          icon={<XCircle className="size-3.5" />}
        />
        <Stat
          label="Scheduled tasks"
          value={o.counts.scheduledTasks}
          source="not_tracked"
          hint="Recurring schedules are not built yet"
          icon={<Clock className="size-3.5" />}
        />
        <Stat
          label="Provider latency p50 / p95"
          value={
            o.ai.latencyP50Ms == null
              ? "—"
              : `${formatDuration(o.ai.latencyP50Ms)} / ${formatDuration(o.ai.latencyP95Ms)}`
          }
          icon={<Gauge className="size-3.5" />}
        />
      </section>

      <section
        aria-label="AI spend and finance"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <Stat
          label={`AI operating cost (${o.days}d)`}
          value={formatUsd(o.ai.costUsd)}
          hint={`Today ${formatUsd(o.ai.spendTodayUsd)} · month ${formatUsd(o.ai.spendMonthUsd)} of ${formatUsd(env.AI_MONTHLY_BUDGET_USD)}`}
          icon={<DollarSign className="size-3.5" />}
        />
        <Stat
          label={`API consumption (${o.days}d)`}
          value={formatNumber(o.ai.tokensIn + o.ai.tokensOut)}
          hint={`${formatNumber(o.ai.tokensIn)} input · ${formatNumber(o.ai.tokensOut)} output tokens${o.ai.mockRuns ? ` · ${o.ai.mockRuns} mock run(s)` : ""}`}
        />
        <Stat
          label={`Net revenue (${o.days}d)`}
          value={o.finance.hasRevenue ? formatMoney(o.finance.netRevenue) : null}
          source={o.finance.hasRevenue ? "user_entered" : "not_tracked"}
          hint={
            o.finance.hasRevenue
              ? "From finance entries people record"
              : "Record revenue on the Finance page. Nothing is estimated."
          }
        />
        <Stat
          label={`Net profit (${o.days}d)`}
          value={o.finance.hasRevenue ? formatMoney(o.finance.netProfit) : null}
          source={o.finance.hasRevenue ? "user_entered" : "not_tracked"}
          hint={
            o.finance.hasRevenue
              ? "Net revenue − costs, including measured AI cost"
              : "Needs revenue entries"
          }
        />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>AI cost over time</CardTitle>
              <CardDescription>Provider-reported usage × configured price table</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {o.ai.totalRuns === 0 ? (
              <EmptyState title="No runs in this period" />
            ) : (
              <CostChart data={o.series} />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Token consumption</CardTitle>
              <CardDescription>Input and output tokens per day</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {o.ai.totalRuns === 0 ? (
              <EmptyState title="No runs in this period" />
            ) : (
              <TokenChart data={o.series} />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Run outcomes</CardTitle>
              <CardDescription>Succeeded vs failed agent runs per day</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {o.ai.totalRuns === 0 ? (
              <EmptyState title="No runs in this period" />
            ) : (
              <OutcomeChart data={o.series} />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>AI cost by agent</CardTitle>
              <CardDescription>Selected period</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {o.costByAgent.length === 0 ? (
              <EmptyState title="No runs in this period" />
            ) : (
              <CostByAgentChart data={o.costByAgent} />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <RunList title="Recently completed" empty="No completed runs yet" runs={o.recentRuns} />
        <RunList title="Failed jobs" empty="No failed runs" runs={o.recentFailures} showError />
        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <Link href="/activity" className="text-xs text-primary hover:underline">
              View all
            </Link>
          </CardHeader>
          <CardContent>
            {o.audit.length === 0 ? (
              <EmptyState title="No activity yet" />
            ) : (
              <ul className="space-y-2.5">
                {o.audit.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      <Badge tone="neutral" className="mr-1.5">
                        {e.actorType}
                      </Badge>
                      {e.summary}
                    </span>
                    <time
                      className="shrink-0 text-xs text-muted-foreground"
                      dateTime={e.createdAt.toISOString()}
                    >
                      {relativeTime(e.createdAt)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

type RunRow = Awaited<ReturnType<typeof getOverview>>["recentRuns"][number];

function RunList({
  title,
  runs,
  empty,
  showError,
}: {
  title: string;
  runs: RunRow[];
  empty: string;
  showError?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {runs.length === 0 ? (
          <EmptyState title={empty} />
        ) : (
          <ul className="space-y-2.5">
            {runs.map((r) => (
              <li key={r.id} className="text-sm">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={`/tasks/${r.task.id}`}
                    className="truncate font-medium hover:underline"
                  >
                    {r.task.title}
                  </Link>
                  <time className="shrink-0 text-xs text-muted-foreground">
                    {relativeTime(r.finishedAt)}
                  </time>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {r.agent.name}
                  {r.provider === "mock" && <ProviderBadge provider="mock" />}
                  {r.costUsd != null && <span>· {formatUsd(Number(r.costUsd))}</span>}
                </div>
                {showError && r.errorMessage && (
                  <p className="mt-1 line-clamp-2 text-xs text-danger">{r.errorMessage}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
