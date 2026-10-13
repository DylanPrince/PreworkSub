import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ForbiddenError,
  NotFoundError,
  commandSignature,
  getAiStatus,
  getCommand,
  runPolicyFromEnv,
} from "@prince/core";
import { formatUsd } from "@prince/shared";
import { DispatchPanel, type WorkstreamView } from "@/components/command/dispatch-panel";
import { PageHeader } from "@/components/common/page-header";
import { ProgressPoller } from "@/components/common/progress-poller";
import { ProviderBadge, StatusBadge } from "@/components/common/status-badge";
import { RunActions } from "@/components/tasks/run-controls";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getRunModes } from "@/lib/run-modes";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";
import { relativeTime } from "@/lib/utils";

export const metadata = { title: "Command" };

export default async function CommandPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  let view;
  try {
    view = await getCommand(db, user.id, id);
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof ForbiddenError) notFound();
    throw e;
  }
  const [{ signature, active }, modes, ai] = await Promise.all([
    commandSignature(db, user.id, id),
    getRunModes(),
    getAiStatus(db, runPolicyFromEnv()),
  ]);
  const { command, planTask, plan } = view;
  const planRun = planTask?.runs[0] ?? null;
  const spent = command.tasks.reduce(
    (n, t) => n + t.runs.reduce((m, r) => m + Number(r.costUsd ?? 0), 0),
    0,
  );
  const workstreams: WorkstreamView[] = view.workstreams.map((w) => ({
    title: w.title,
    owner: w.owner,
    description: w.description,
    dependsOn: w.dependsOn,
    requiresHumanApproval: w.requiresHumanApproval,
    ready: w.ready,
    awaitingApproval: w.awaitingApproval,
    approval: w.approval,
    unmetDependencies: w.unmetDependencies,
    suggestedAgentId: w.suggestedAgentId,
    estimates: w.estimates,
    task: w.task
      ? {
          id: w.task.id,
          status: w.task.status,
          agentName: w.task.agentName,
          provider: w.task.latestRun?.provider ?? null,
          costUsd: w.task.latestRun?.costUsd == null ? null : Number(w.task.latestRun.costUsd),
        }
      : null,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Command"
        description={`${command.business.name} · requested by ${command.createdBy.name} ${relativeTime(command.createdAt)} · ${formatUsd(spent, { precise: true })} spent so far`}
        actions={
          <ProgressPoller
            url={`/api/v1/commands/${command.id}`}
            signature={signature}
            active={active}
          />
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Request</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm whitespace-pre-wrap">{command.request}</p>
        </CardContent>
      </Card>

      <Card aria-label="Plan">
        <CardHeader className="flex-wrap">
          <div>
            <CardTitle>Plan</CardTitle>
            {planTask && (
              <CardDescription>
                By {planTask.agent.name} ·{" "}
                <Link href={`/tasks/${planTask.id}`} className="text-primary hover:underline">
                  run details
                </Link>
              </CardDescription>
            )}
          </div>
          {planRun && (
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={planRun.status} />
              <ProviderBadge provider={planRun.provider} />
              <RunActions runId={planRun.id} status={planRun.status} />
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {!planRun ? (
            <p className="text-sm text-muted-foreground">The plan was not started.</p>
          ) : !plan ? (
            planRun.status === "failed" || planRun.status === "cancelled" ? (
              <p role="alert" className="text-sm text-danger">
                Planning {planRun.status}
                {planRun.errorMessage ? `: ${planRun.errorMessage}` : "."} Retry the plan to
                continue.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">The planning agent is working…</p>
            )
          ) : (
            <>
              {planRun.provider === "mock" && (
                <p className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning">
                  This plan came from the mock provider. It is a placeholder for testing the flow,
                  not a real plan.
                </p>
              )}
              <p className="text-sm">{plan.summary}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Risks
                  </h3>
                  <ul className="mt-1 list-inside list-disc text-sm">
                    {plan.risks.length ? (
                      plan.risks.map((r) => <li key={r}>{r}</li>)
                    ) : (
                      <li>None listed</li>
                    )}
                  </ul>
                </div>
                <div>
                  <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Decisions for you
                  </h3>
                  <ul className="mt-1 list-inside list-disc text-sm">
                    {plan.decisionsForOwner.length ? (
                      plan.decisionsForOwner.map((d) => <li key={d}>{d}</li>)
                    ) : (
                      <li>None listed</li>
                    )}
                  </ul>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {plan && (
        <Card aria-label="Workstreams">
          <CardHeader>
            <div>
              <CardTitle>Workstreams</CardTitle>
              <CardDescription>
                Review and dispatch. A workstream unlocks once the ones it depends on have
                succeeded, and their results are passed along.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <DispatchPanel
              key={signature}
              commandId={command.id}
              workstreams={workstreams}
              agents={view.agents}
              modes={modes}
              remainingUsd={Math.min(ai.budget.day.remainingUsd, ai.budget.month.remainingUsd)}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
