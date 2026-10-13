import Link from "next/link";
import { listBusinesses, listCommands } from "@prince/core";
import { CommandComposer } from "@/components/command/command-composer";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ProviderBadge, StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getRunModes } from "@/lib/run-modes";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";
import { relativeTime } from "@/lib/utils";

export const metadata = { title: "AI Command Center" };

export default async function CommandCenterPage() {
  const user = await requireUser();
  const [businesses, commands, modes] = await Promise.all([
    listBusinesses(db, user.id),
    listCommands(db, user.id),
    getRunModes(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Command Center"
        description="State an objective. A planning agent breaks it into workstreams; you review the plan and its cost before any specialist agent starts."
      />
      {businesses.length === 0 ? (
        <EmptyState
          title="Create a business first"
          description="Requests are always made for a business, so agents work with its context."
          action={
            <Button asChild>
              <Link href="/businesses/new">Create business</Link>
            </Button>
          }
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>New request</CardTitle>
          </CardHeader>
          <CardContent>
            <CommandComposer
              businesses={businesses.map((b) => ({ id: b.id, name: b.name }))}
              modes={modes}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Recent requests</CardTitle>
            <CardDescription>
              Each request keeps its plan, dispatched work and costs.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {commands.length === 0 ? (
            <p className="text-sm text-muted-foreground">No requests yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {commands.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/command/${c.id}`}
                      className="line-clamp-2 text-sm font-medium hover:underline"
                    >
                      {c.request}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {c.business.name} · {relativeTime(c.createdAt)} · {c.dispatched} workstream
                      {c.dispatched === 1 ? "" : "s"} dispatched, {c.succeeded} done
                      {c.active > 0 && `, ${c.active} running`}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Plan</span>
                    <StatusBadge status={c.planStatus} />
                    {c.provider && <ProviderBadge provider={c.provider} />}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
