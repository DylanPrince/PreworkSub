import { Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ForbiddenError, getBusiness, listTasks } from "@prince/core";
import { formatUsd } from "@prince/shared";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";
import { relativeTime } from "@/lib/utils";

export default async function BusinessPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  let business;
  try {
    business = await getBusiness(db, user.id, id);
  } catch (e) {
    if (e instanceof ForbiddenError) notFound();
    throw e;
  }
  const [tasks, spend] = await Promise.all([
    listTasks(db, user.id, { businessId: id }),
    db.agentRun.aggregate({
      where: { businessId: id },
      _sum: { costUsd: true, inputTokens: true, outputTokens: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={business.name}
        description={business.businessModel || undefined}
        actions={
          <Button asChild>
            <Link href={`/tasks/new?business=${business.id}`}>
              <Plus /> New task
            </Link>
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>About</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p className="whitespace-pre-wrap text-muted-foreground">
              {business.description || "No description."}
            </p>
            <div>
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Goals
              </h3>
              {business.goals.length === 0 ? (
                <p className="mt-1 text-muted-foreground">No goals recorded.</p>
              ) : (
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  {business.goals.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Workspace</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">AI cost (all time)</span>
              <span className="font-mono">{formatUsd(Number(spend._sum.costUsd ?? 0))}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tokens</span>
              <span className="font-mono">
                {(spend._sum.inputTokens ?? 0) + (spend._sum.outputTokens ?? 0)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Revenue</span>
              <Badge>Not tracked</Badge>
            </div>
            <div>
              <p className="text-muted-foreground">Members</p>
              <ul className="mt-1 space-y-1">
                {business.memberships.map((m) => (
                  <li key={m.id} className="flex items-center justify-between">
                    <span>{m.user.name}</span>
                    <Badge tone="primary">{m.role}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Tasks</CardTitle>
        </CardHeader>
        <CardContent>
          {tasks.length === 0 ? (
            <EmptyState
              title="No tasks yet"
              description="Create a task and assign it to an agent."
            />
          ) : (
            <ul className="divide-y divide-border">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <Link
                    href={`/tasks/${t.id}`}
                    className="min-w-0 truncate font-medium hover:underline"
                  >
                    {t.title}
                  </Link>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {t.agent.name} · {relativeTime(t.createdAt)} <StatusBadge status={t.status} />
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
