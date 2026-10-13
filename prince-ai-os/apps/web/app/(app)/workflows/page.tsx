import { Plus } from "lucide-react";
import Link from "next/link";
import { WORKFLOW_TEMPLATES, listWorkflows, workflowEditorOptions } from "@prince/core";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ProviderBadge, StatusBadge } from "@/components/common/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UseTemplateForm } from "@/components/workflows/workflow-controls";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";
import { relativeTime } from "@/lib/utils";

export const metadata = { title: "Workflows" };

export default async function WorkflowsPage() {
  const user = await requireUser();
  const [workflows, options] = await Promise.all([
    listWorkflows(db, user.id),
    workflowEditorOptions(db, user.id),
  ]);
  const canCreate = options.businesses.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workflows"
        description="Saved multi-agent procedures. Each step runs as soon as the steps it waits for have succeeded; steps marked for approval wait for an admin or owner."
        actions={
          canCreate && (
            <Button asChild>
              <Link href="/workflows/new">
                <Plus /> New workflow
              </Link>
            </Button>
          )
        }
      />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Your workflows</CardTitle>
            <CardDescription>
              Started by hand with an input. Scheduling is not built yet.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {workflows.length === 0 ? (
            <EmptyState
              title="No workflows yet"
              description={
                canCreate
                  ? "Start from a template below or build one step by step."
                  : "Business admins and owners create workflows."
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {workflows.map((w) => (
                <li
                  key={w.id}
                  className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/workflows/${w.id}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {w.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {w.business.name} · {w.stepCount} step{w.stepCount === 1 ? "" : "s"} ·{" "}
                      {w.runCount} run{w.runCount === 1 ? "" : "s"}
                      {w.lastRun && ` · last ${relativeTime(w.lastRun.createdAt)}`}
                    </p>
                  </div>
                  <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {w.status !== "active" && <StatusBadge status={w.status} />}
                    {w.lastRun && (
                      <>
                        <span className="text-xs text-muted-foreground">Last run</span>
                        <StatusBadge status={w.lastRun.status} />
                        <ProviderBadge provider={w.lastRun.provider} />
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <section aria-labelledby="templates-heading" className="space-y-3">
        <h2 id="templates-heading" className="text-sm font-semibold">
          Templates
        </h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {WORKFLOW_TEMPLATES.map((t) => (
            <Card key={t.key}>
              <CardHeader>
                <div>
                  <CardTitle>{t.name}</CardTitle>
                  <CardDescription>{t.description}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <ol className="space-y-1.5 text-sm">
                  {t.steps.map((s, i) => (
                    <li key={s.title} className="flex flex-wrap items-center gap-1.5">
                      <span className="text-muted-foreground">{i + 1}.</span> {s.title}
                      {s.dependsOn.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          after {s.dependsOn.join(", ")}
                        </span>
                      )}
                      {s.requiresApproval && <Badge tone="warning">Needs approval</Badge>}
                    </li>
                  ))}
                </ol>
                {canCreate ? (
                  <UseTemplateForm
                    templateKey={t.key}
                    templateName={t.name}
                    businesses={options.businesses}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Business admins and owners can add templates.
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
