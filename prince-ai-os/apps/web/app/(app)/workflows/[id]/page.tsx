import { Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ForbiddenError,
  NotFoundError,
  getAiStatus,
  getWorkflow,
  runPolicyFromEnv,
} from "@prince/core";
import { formatUsd } from "@prince/shared";
import { PageHeader } from "@/components/common/page-header";
import { ProviderBadge, StatusBadge } from "@/components/common/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkflowRunForm, WorkflowStatusControls } from "@/components/workflows/workflow-controls";
import { getRunModes } from "@/lib/run-modes";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";
import { relativeTime } from "@/lib/utils";

export const metadata = { title: "Workflow" };

export default async function WorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  let view;
  try {
    view = await getWorkflow(db, user.id, id);
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof ForbiddenError) notFound();
    throw e;
  }
  const [modes, ai] = await Promise.all([getRunModes(), getAiStatus(db, runPolicyFromEnv())]);
  const { workflow, steps } = view;
  const unavailable = steps.filter((s) => !s.agentAvailable).map((s) => s.title);
  const disabledReason =
    workflow.status !== "active"
      ? `This workflow is ${workflow.status}. Enable it to start runs.`
      : unavailable.length
        ? `The agent for ${unavailable.join(", ")} is no longer available. Edit the workflow to choose another.`
        : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title={workflow.name}
        description={`${workflow.business.name} · version ${workflow.version} · created by ${workflow.createdBy.name}${workflow.description ? ` · ${workflow.description}` : ""}`}
        actions={
          view.canEdit && (
            <>
              <Button asChild size="sm" variant="secondary">
                <Link href={`/workflows/${workflow.id}/edit`}>
                  <Pencil /> Edit
                </Link>
              </Button>
              <WorkflowStatusControls workflowId={workflow.id} status={workflow.status} />
            </>
          )
        }
      />

      <Card aria-label="Steps">
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              Steps <StatusBadge status={workflow.status} />
            </CardTitle>
            <CardDescription>
              Worst case with Claude for the longest input:{" "}
              {formatUsd(view.totalWorstCaseUsd, { precise: true })} in total.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {steps.map((s, i) => (
              <li key={s.title} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    <span className="text-muted-foreground">{i + 1}.</span> {s.title}
                  </p>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {s.requiresApproval && <Badge tone="warning">Needs approval</Badge>}
                    {!s.agentAvailable && <Badge tone="danger">Agent unavailable</Badge>}
                    <span className="text-xs text-muted-foreground">
                      up to{" "}
                      {s.worstCaseUsd == null
                        ? "unknown"
                        : formatUsd(s.worstCaseUsd, { precise: true })}
                    </span>
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {s.agentName}
                  {s.dependsOn.length > 0 && ` · waits for ${s.dependsOn.join(", ")}`}
                </p>
                <p className="mt-2 text-sm whitespace-pre-wrap">{s.instructions}</p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {view.canRun && (
        <Card>
          <CardHeader>
            <CardTitle>Start a run</CardTitle>
          </CardHeader>
          <CardContent>
            <WorkflowRunForm
              workflowId={workflow.id}
              modes={modes}
              worstCaseUsd={view.totalWorstCaseUsd}
              remainingUsd={Math.min(ai.budget.day.remainingUsd, ai.budget.month.remainingUsd)}
              disabledReason={disabledReason}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent runs</CardTitle>
        </CardHeader>
        <CardContent>
          {workflow.runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {workflow.runs.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/workflows/runs/${r.id}`}
                      className="line-clamp-1 text-sm font-medium hover:underline"
                    >
                      {r.input}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {r.startedBy.name} · {relativeTime(r.createdAt)} · v{r.workflowVersion}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <StatusBadge status={r.status} />
                    <ProviderBadge provider={r.provider} />
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
