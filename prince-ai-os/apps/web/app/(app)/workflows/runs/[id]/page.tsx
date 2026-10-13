import Link from "next/link";
import { notFound } from "next/navigation";
import { ForbiddenError, NotFoundError, getWorkflowRun, workflowRunSignature } from "@prince/core";
import { formatUsd } from "@prince/shared";
import { ApprovalStatusBadge } from "@/components/approvals/approval-status";
import { PageHeader } from "@/components/common/page-header";
import { ProgressPoller } from "@/components/common/progress-poller";
import { ProviderBadge, StatusBadge } from "@/components/common/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CancelWorkflowRunButton } from "@/components/workflows/workflow-controls";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";
import { relativeTime } from "@/lib/utils";

export const metadata = { title: "Workflow run" };

export default async function WorkflowRunPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  let view;
  try {
    view = await getWorkflowRun(db, user.id, id);
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof ForbiddenError) notFound();
    throw e;
  }
  const { signature, active } = await workflowRunSignature(db, user.id, id);
  const { run } = view;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Run of ${run.workflow.name}`}
        description={`${run.business.name} · started by ${view.startedByName} ${relativeTime(run.createdAt)} · version ${run.workflowVersion} · ${formatUsd(view.costUsd, { precise: true })} spent`}
        actions={
          <>
            <ProgressPoller
              url={`/api/v1/workflow-runs/${run.id}`}
              signature={signature}
              active={active}
            />
            {view.canCancel && <CancelWorkflowRunButton runId={run.id} />}
          </>
        }
      />

      <Card>
        <CardHeader className="flex-wrap">
          <div>
            <CardTitle>Input</CardTitle>
            <CardDescription>
              <Link href={`/workflows/${run.workflow.id}`} className="text-primary hover:underline">
                Back to the workflow
              </Link>
            </CardDescription>
          </div>
          <span className="flex items-center gap-1.5">
            <StatusBadge status={run.status} />
            <ProviderBadge provider={run.provider} />
          </span>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm whitespace-pre-wrap">{run.input}</p>
          {run.provider === "mock" && (
            <p className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning">
              Dry run: every step uses the mock provider, which returns labelled placeholder output,
              not real analysis.
            </p>
          )}
          {run.status === "waiting_approval" && (
            <p className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning">
              A step is waiting for approval. An admin or owner decides in{" "}
              <Link href="/approvals" className="underline underline-offset-2">
                Approvals
              </Link>
              .
            </p>
          )}
          {run.error && (
            <p role="alert" className="text-sm text-danger">
              {run.error}
            </p>
          )}
        </CardContent>
      </Card>

      <Card aria-label="Step progress">
        <CardHeader>
          <CardTitle>Steps</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {view.steps.map((s, i) => (
              <li
                key={s.title}
                aria-label={s.title}
                className="flex flex-col gap-2 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    <span className="text-muted-foreground">{i + 1}.</span> {s.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {s.agentName}
                    {!s.task &&
                      s.waitingOn.length > 0 &&
                      ` · waiting for ${s.waitingOn.join(", ")}`}
                    {s.latestRun?.costUsd != null &&
                      ` · ${formatUsd(s.latestRun.costUsd, { precise: true })}`}
                  </p>
                </div>
                <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {s.approval && (
                    <Link href={`/approvals/${s.approval.id}`} className="hover:underline">
                      <ApprovalStatusBadge status={s.approval.status} />
                    </Link>
                  )}
                  {s.task ? (
                    <>
                      <StatusBadge status={s.task.status} />
                      {s.latestRun && <ProviderBadge provider={s.latestRun.provider} />}
                      <Link
                        href={`/tasks/${s.task.id}`}
                        className="text-xs text-primary hover:underline"
                      >
                        Open result
                      </Link>
                    </>
                  ) : (
                    !s.approval && (
                      <span className="text-xs text-muted-foreground">Not started</span>
                    )
                  )}
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
