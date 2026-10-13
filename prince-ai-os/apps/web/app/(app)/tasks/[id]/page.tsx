import Link from "next/link";
import { notFound } from "next/navigation";
import { getContract } from "@prince/agents";
import { ForbiddenError, NotFoundError, getCurrentVersion, getTask } from "@prince/core";
import { formatDuration, formatNumber, formatUsd } from "@prince/shared";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ProviderBadge, StatusBadge } from "@/components/common/status-badge";
import { RunActions, RunPoller, RunTaskButton } from "@/components/tasks/run-controls";
import { StructuredOutput } from "@/components/tasks/structured-output";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/server";
import { getRunModes } from "@/lib/run-modes";
import { requireUser } from "@/lib/session";
import { relativeTime } from "@/lib/utils";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  let task;
  try {
    task = await getTask(db, user.id, id);
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof ForbiddenError) notFound();
    throw e;
  }
  const latest = task.runs[0];
  const hasActive = task.runs.some((r) => r.status === "queued" || r.status === "running");
  const [version, modes] = await Promise.all([getCurrentVersion(db, task.agentId), getRunModes()]);
  const executable = task.agent.status === "active" && !!getContract(version.outputSchemaKey);

  return (
    <div className="space-y-6">
      <PageHeader
        title={task.title}
        description={`${task.business.name} · assigned to ${task.agent.name} · created by ${task.createdBy.name} ${relativeTime(task.createdAt)}`}
        actions={
          <>
            <StatusBadge status={task.status} />
            <RunTaskButton taskId={task.id} modes={modes} disabled={hasActive || !executable} />
          </>
        }
      />
      {(task.commandId || task.kind === "test") && (
        <p className="text-sm text-muted-foreground">
          {task.commandId && (
            <Link href={`/command/${task.commandId}`} className="text-primary hover:underline">
              {task.workstream
                ? `Workstream of a Command Center request`
                : "Plan for a Command Center request"}
            </Link>
          )}
          {task.kind === "test" && (
            <Link href={`/agent-builder/${task.agent.id}`} className="text-primary hover:underline">
              Agent Builder test run
            </Link>
          )}
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Instructions</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm whitespace-pre-wrap">{task.instructions}</p>
        </CardContent>
      </Card>

      {!latest ? (
        <EmptyState
          title="Not run yet"
          description="Run the agent to produce an output. The run executes in the background worker."
        />
      ) : (
        task.runs.map((run, index) => (
          <Card
            key={run.id}
            aria-label={index === 0 ? "Latest run" : `Earlier run #${task.runs.length - index}`}
          >
            <CardHeader className="flex-wrap">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>
                  {index === 0 ? "Latest run" : `Earlier run #${task.runs.length - index}`}
                </CardTitle>
                <StatusBadge status={run.status} />
                <ProviderBadge provider={run.provider} />
                <Badge>v{run.agentVersion}</Badge>
                {run.costIsEstimate && <Badge tone="info">Estimated cost</Badge>}
              </div>
              <div className="flex items-center gap-3">
                {index === 0 && (
                  <RunPoller runId={run.id} status={run.status} eventCount={run.events.length} />
                )}
                <RunActions runId={run.id} status={run.status} />
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
                <Metric
                  label="Model"
                  value={<code className="font-mono text-xs">{run.model}</code>}
                />
                <Metric
                  label="Input tokens"
                  value={run.inputTokens == null ? "—" : formatNumber(run.inputTokens)}
                />
                <Metric
                  label="Output tokens"
                  value={
                    run.outputTokens == null ? (
                      "—"
                    ) : (
                      <>
                        {formatNumber(run.outputTokens)}
                        {(run.thinkingTokens ?? 0) > 0 && (
                          <span className="block text-xs font-normal text-muted-foreground">
                            incl. {formatNumber(run.thinkingTokens!)} thinking
                          </span>
                        )}
                      </>
                    )
                  }
                />
                <Metric
                  label="Cost"
                  value={
                    run.costUsd == null ? "—" : formatUsd(Number(run.costUsd), { precise: true })
                  }
                />
                <Metric label="Provider latency" value={formatDuration(run.providerLatencyMs)} />
                <Metric label="Attempts" value={run.attempts} />
              </dl>
              {(run.cacheReadInputTokens ?? 0) + (run.cacheCreationInputTokens ?? 0) > 0 && (
                <p className="text-xs text-muted-foreground">
                  Cache: {formatNumber(run.cacheReadInputTokens ?? 0)} read ·{" "}
                  {formatNumber(run.cacheCreationInputTokens ?? 0)} written
                </p>
              )}
              {run.errorMessage && (
                <div
                  role="alert"
                  className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger"
                >
                  <span className="font-mono text-xs">{run.errorCode}</span> {run.errorMessage}
                </div>
              )}
              {run.provider === "mock" && run.output != null && (
                <p className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning">
                  This output came from the local mock provider. It is a placeholder for testing the
                  pipeline, not real analysis.
                </p>
              )}
              {run.output != null && (
                <section aria-label="Agent output">
                  <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Output
                  </h3>
                  <div className="rounded-lg border border-border p-4">
                    <StructuredOutput value={orderedOutput(run.output, run.outputText)} />
                  </div>
                </section>
              )}
              <details open={index === 0}>
                <summary className="cursor-pointer text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Execution timeline
                </summary>
                <ol className="mt-2 space-y-1.5 border-l border-border pl-4">
                  {run.events.map((e) => (
                    <li key={e.id} className="text-sm">
                      <span className="font-mono text-xs text-muted-foreground">
                        {e.createdAt.toISOString().slice(11, 19)}
                      </span>{" "}
                      <Badge className="mx-1">{e.type}</Badge>
                      {e.message}
                    </li>
                  ))}
                </ol>
              </details>
            </CardContent>
          </Card>
        ))
      )}
      <p className="text-xs text-muted-foreground">
        <Link href={`/agents/${task.agent.id}`} className="text-primary hover:underline">
          View {task.agent.name} configuration and history
        </Link>
      </p>
    </div>
  );
}

/** Postgres JSONB does not keep key order; the raw provider text does, so prefer it for display. */
function orderedOutput(output: unknown, raw: string | null): unknown {
  if (!raw) return output;
  try {
    return JSON.parse(raw);
  } catch {
    return output;
  }
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm">{value}</dd>
    </div>
  );
}
