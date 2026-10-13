import Link from "next/link";
import { CATEGORY_LABELS, listApprovals } from "@prince/core";
import { formatUsd } from "@prince/shared";
import { ApprovalStatusBadge } from "@/components/approvals/approval-status";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";
import { relativeTime, timeUntil } from "@/lib/utils";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const user = await requireUser();
  const { pending, decided } = await listApprovals(db, user.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals"
        description="Actions that need a human decision. Nothing here happens until a business admin or owner approves it; the server enforces this, and every request and decision is in the activity log."
      />

      <Card aria-label="Waiting for a decision">
        <CardHeader>
          <div>
            <CardTitle>Waiting for a decision</CardTitle>
            <CardDescription>
              Requests expire after 72 hours. A rejected request cannot be sent again unchanged.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing is waiting for a decision.</p>
          ) : (
            <ul className="divide-y divide-border">
              {pending.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <Link href={`/approvals/${r.id}`} className="font-medium hover:underline">
                      {r.title}
                    </Link>
                    <p className="text-sm text-muted-foreground">{r.summary}</p>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <Badge tone="warning">{CATEGORY_LABELS[r.category]}</Badge>
                      <span>
                        {r.business.name} · requested by {r.requestedByName}{" "}
                        {relativeTime(r.createdAt)} · expires {timeUntil(r.expiresAt)}
                        {r.estimatedCostUsd != null &&
                          Number(r.estimatedCostUsd) > 0 &&
                          ` · worst case ${formatUsd(Number(r.estimatedCostUsd), { precise: true })}`}
                      </span>
                    </div>
                  </div>
                  <Button asChild size="sm" variant={r.canDecide ? "default" : "secondary"}>
                    <Link href={`/approvals/${r.id}`}>{r.canDecide ? "Review" : "View"}</Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card aria-label="History">
        <CardHeader>
          <div>
            <CardTitle>History</CardTitle>
            <CardDescription>
              The 50 most recent decided, expired or withdrawn requests.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {decided.length === 0 ? (
            <p className="text-sm text-muted-foreground">No decisions yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Request</th>
                    <th className="py-2 pr-4 font-medium">Business</th>
                    <th className="py-2 pr-4 font-medium">Outcome</th>
                    <th className="py-2 pr-4 font-medium">Decided by</th>
                    <th className="py-2 font-medium">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {decided.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2 pr-4">
                        <Link href={`/approvals/${r.id}`} className="hover:underline">
                          {r.title}
                        </Link>
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">{r.business.name}</td>
                      <td className="py-2 pr-4">
                        <ApprovalStatusBadge status={r.status} />
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {r.decidedBy?.name ?? "—"}
                      </td>
                      <td className="py-2 whitespace-nowrap text-muted-foreground">
                        {relativeTime(r.decidedAt ?? r.updatedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
