import Link from "next/link";
import { Suspense } from "react";
import { listBusinesses, listCampaigns, writableBusinesses } from "@prince/core";
import { formatMoney } from "@prince/shared";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { NewCampaignForm } from "@/components/modules/marketing-forms";
import { OverviewFilters } from "@/components/overview/filters";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Marketing" };

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<{ business?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const [businesses, writable] = await Promise.all([
    listBusinesses(db, user.id),
    writableBusinesses(db, user.id),
  ]);
  const scoped = businesses.find((b) => b.id === sp.business);
  const campaigns = await listCampaigns(db, user.id, { businessId: scoped?.id });
  const multi = businesses.length > 1 && !scoped;
  const planned = campaigns
    .filter((c) => c.status !== "ended")
    .reduce((n, c) => n + (c.budgetUsd ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Marketing"
        description="Plan campaigns and get launch approval for the exact budget, dates and channels. No ad platform is connected: nothing is launched or spent from here, and performance is not tracked yet."
        actions={
          businesses.length > 1 && (
            <Suspense>
              <OverviewFilters
                businesses={businesses.map((b) => ({ id: b.id, name: b.name }))}
                ranges={[]}
              />
            </Suspense>
          )
        }
      />

      <Card className="overflow-x-auto">
        <CardHeader>
          <div>
            <CardTitle>Campaigns</CardTitle>
            <CardDescription>
              Planned budget across active campaigns: {formatMoney(planned)} (user-entered plan, not
              spend).
            </CardDescription>
          </div>
        </CardHeader>
        {campaigns.length === 0 ? (
          <CardContent>
            <EmptyState title="No campaigns yet" description="Plan one below." />
          </CardContent>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">Campaigns</caption>
            <thead className="border-y border-border text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Campaign</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Dates</th>
                <th className="px-4 py-2.5 text-right font-medium">Planned budget</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2.5">
                    <Link href={`/marketing/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {[multi && c.business.name, c.channels.join(", ") || "No channels yet"]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="flex flex-wrap gap-1.5">
                      <StatusBadge status={c.status} />
                      {c.pendingApprovalId && <Badge tone="warning">Awaiting approval</Badge>}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">
                    {day(c.startsOn) ?? "—"} → {day(c.endsOn) ?? "open"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                    {c.budgetUsd == null ? (
                      <span className="text-muted-foreground">Not set</span>
                    ) : (
                      formatMoney(c.budgetUsd)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="max-w-3xl">
        <CardHeader>
          <div>
            <CardTitle>Plan a campaign</CardTitle>
            <CardDescription>
              A budget, start date and channel are needed before asking for launch approval.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {writable.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {businesses.length === 0
                ? "Create a business first."
                : "Viewers can read campaigns but not plan them."}
            </p>
          ) : (
            <NewCampaignForm businesses={writable.map((b) => ({ value: b.id, label: b.name }))} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
