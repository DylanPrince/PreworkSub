import Link from "next/link";
import { Suspense } from "react";
import { getAnalytics, listBusinesses } from "@prince/core";
import { formatDuration, formatMoney, formatUsd } from "@prince/shared";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Stat } from "@/components/common/stat";
import { humanize } from "@/components/modules/options";
import { MonthlyPnlChart } from "@/components/overview/charts";
import { OverviewFilters } from "@/components/overview/filters";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata = { title: "Analytics" };

const RANGES = [7, 30, 90, 365];
const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);
const th = "px-4 py-2.5 font-medium";
const td = "px-4 py-2";
const num = "text-right font-mono tabular-nums";

function Pipeline({
  title,
  href,
  stages,
  counts,
}: {
  title: string;
  href: string;
  stages: string[];
  counts: Record<string, number>;
}) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>
          <Link href={href} className="hover:underline">
            {title}
          </Link>
        </CardTitle>
        <span className="text-xs text-muted-foreground">{total}</span>
      </CardHeader>
      <CardContent>
        <dl className="space-y-1 text-sm">
          {stages.map((s) => (
            <div key={s} className="flex justify-between">
              <dt className="text-muted-foreground">{humanize(s)}</dt>
              <dd className="font-mono tabular-nums">{counts[s] ?? 0}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ business?: string; days?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const days = RANGES.includes(Number(sp.days)) ? Number(sp.days) : 30;
  const businesses = await listBusinesses(db, user.id);
  const scoped = businesses.find((b) => b.id === sp.business);
  const a = await getAnalytics(db, user.id, { businessId: scoped?.id, days });
  const finished = a.agentUtilization.reduce((n, r) => n + r.succeeded + r.failed, 0);
  const succeeded = a.agentUtilization.reduce((n, r) => n + r.succeeded, 0);
  const anyFinance = a.monthly.some((m) => m.entries > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Computed from platform records: agent runs and costs are measured; business figures come from the entries people record. Nothing is sample data."
        actions={
          <Suspense>
            <OverviewFilters
              businesses={businesses.map((b) => ({ id: b.id, name: b.name }))}
              ranges={RANGES}
              defaultDays={30}
            />
          </Suspense>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Agent runs" value={String(a.totals.runs)} hint={`Last ${a.days} days`} />
        <Stat
          label="Run success rate"
          value={finished ? pct(succeeded / finished) : null}
          hint={finished ? `${succeeded} of ${finished} finished runs` : "No finished runs"}
        />
        <Stat
          label="AI cost"
          value={formatUsd(a.totals.costUsd, {
            precise: a.totals.costUsd > 0 && a.totals.costUsd < 1,
          })}
          hint="Measured from provider usage"
        />
        <Stat
          label="Workflow runs"
          value={String(a.totals.workflowRuns)}
          hint={`Last ${a.days} days`}
        />
      </div>

      <Card className="overflow-x-auto">
        <CardHeader>
          <div>
            <CardTitle>Agent utilization</CardTitle>
            <CardDescription>Runs queued in the period, by agent.</CardDescription>
          </div>
        </CardHeader>
        {a.agentUtilization.length === 0 ? (
          <CardContent>
            <EmptyState title="No agent runs in this period" />
          </CardContent>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">Agent utilization</caption>
            <thead className="border-y border-border text-left text-xs text-muted-foreground">
              <tr>
                <th className={th}>Agent</th>
                <th className={cn(th, "text-right")}>Runs</th>
                <th className={cn(th, "text-right")}>Success</th>
                <th className={cn(th, "text-right")}>Failed</th>
                <th className={cn(th, "text-right")}>Avg latency</th>
                <th className={cn(th, "text-right")}>Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {a.agentUtilization.map((r) => (
                <tr key={r.agentId}>
                  <td className={td}>
                    <Link href={`/agents/${r.agentId}`} className="hover:underline">
                      {r.agent}
                    </Link>
                    {r.mockRuns > 0 && (
                      <Badge tone="warning" className="ml-2">
                        {r.mockRuns} mock
                      </Badge>
                    )}
                  </td>
                  <td className={cn(td, num)}>{r.runs}</td>
                  <td className={cn(td, num)}>{pct(r.successRate)}</td>
                  <td className={cn(td, num, r.failed > 0 && "text-danger")}>{r.failed}</td>
                  <td className={cn(td, num)}>{formatDuration(r.avgLatencyMs)}</td>
                  <td className={cn(td, num)}>{formatUsd(r.costUsd, { precise: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="overflow-x-auto">
          <CardHeader>
            <div>
              <CardTitle>Workflow success</CardTitle>
              <CardDescription>Runs started in the period.</CardDescription>
            </div>
          </CardHeader>
          {a.workflowStats.length === 0 ? (
            <CardContent>
              <EmptyState title="No workflow runs in this period" />
            </CardContent>
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">Workflow success</caption>
              <thead className="border-y border-border text-left text-xs text-muted-foreground">
                <tr>
                  <th className={th}>Workflow</th>
                  <th className={cn(th, "text-right")}>Runs</th>
                  <th className={cn(th, "text-right")}>Success</th>
                  <th className={cn(th, "text-right")}>Open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {a.workflowStats.map((w) => (
                  <tr key={w.workflowId}>
                    <td className={td}>
                      <Link href={`/workflows/${w.workflowId}`} className="hover:underline">
                        {w.workflow}
                      </Link>
                    </td>
                    <td className={cn(td, num)}>{w.runs}</td>
                    <td className={cn(td, num)}>{pct(w.successRate)}</td>
                    <td className={cn(td, num)}>{w.inProgress}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="overflow-x-auto">
          <CardHeader>
            <div>
              <CardTitle>By business</CardTitle>
              <CardDescription>Last {a.days} days. Profit needs revenue entries.</CardDescription>
            </div>
          </CardHeader>
          {a.perBusiness.length === 0 ? (
            <CardContent>
              <EmptyState title="No businesses" />
            </CardContent>
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">Figures by business</caption>
              <thead className="border-y border-border text-left text-xs text-muted-foreground">
                <tr>
                  <th className={th}>Business</th>
                  <th className={cn(th, "text-right")}>Runs</th>
                  <th className={cn(th, "text-right")}>AI cost</th>
                  <th className={cn(th, "text-right")}>Net profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {a.perBusiness.map((b) => (
                  <tr key={b.businessId}>
                    <td className={td}>
                      <Link
                        href={`/finance?business=${b.businessId}&days=${RANGES.includes(a.days) ? a.days : 30}`}
                        className="hover:underline"
                      >
                        {b.business}
                      </Link>
                    </td>
                    <td className={cn(td, num)}>{b.runs}</td>
                    <td className={cn(td, num)}>{formatUsd(b.aiCostUsd, { precise: true })}</td>
                    <td className={cn(td, num, b.hasRevenue && b.netProfit < 0 && "text-danger")}>
                      {b.hasRevenue ? (
                        formatMoney(b.netProfit)
                      ) : (
                        <span className="text-xs text-muted-foreground">Not tracked</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Monthly profit and loss</CardTitle>
            <CardDescription>
              Last six calendar months (UTC), from recorded entries plus measured AI cost.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {anyFinance ? (
            <MonthlyPnlChart data={a.monthly} />
          ) : (
            <p className="text-sm text-muted-foreground">
              No finance entries in the last six months. Record them on the{" "}
              <Link href="/finance" className="underline">
                Finance
              </Link>{" "}
              page to see trends.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Monthly profit and loss</caption>
              <thead className="border-b border-border text-left text-xs text-muted-foreground">
                <tr>
                  <th className={th}>Month</th>
                  <th className={cn(th, "text-right")}>Net revenue</th>
                  <th className={cn(th, "text-right")}>Costs</th>
                  <th className={cn(th, "text-right")}>Net profit</th>
                  <th className={cn(th, "text-right")}>Entries</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {a.monthly.map((m) => (
                  <tr key={m.month}>
                    <td className={cn(td, "font-mono text-xs")}>{m.month}</td>
                    <td className={cn(td, num)}>{formatMoney(m.netRevenue)}</td>
                    <td className={cn(td, num)}>{formatMoney(m.expenses)}</td>
                    <td className={cn(td, num, m.netProfit < 0 && "text-danger")}>
                      {formatMoney(m.netProfit)}
                    </td>
                    <td className={cn(td, num)}>{m.entries}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <section aria-labelledby="pipelines-heading" className="space-y-3">
        <h2 id="pipelines-heading" className="text-sm font-semibold">
          Pipelines (current)
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Pipeline
            title="Products"
            href="/ecommerce"
            stages={["idea", "researching", "sourcing", "ready", "listed", "retired"]}
            counts={a.pipelines.products}
          />
          <Pipeline
            title="Content"
            href="/content"
            stages={["idea", "drafting", "review", "approved", "published"]}
            counts={a.pipelines.content}
          />
          <Pipeline
            title="Campaigns"
            href="/marketing"
            stages={["planning", "approved", "ended"]}
            counts={a.pipelines.campaigns}
          />
          <Pipeline
            title="SaaS backlog"
            href="/saas"
            stages={["todo", "in_progress", "done"]}
            counts={a.pipelines.backlog}
          />
        </div>
      </section>
    </div>
  );
}
