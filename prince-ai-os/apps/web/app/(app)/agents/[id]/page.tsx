import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError, getAgent } from "@prince/core";
import { formatDuration, formatUsd } from "@prince/shared";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ProviderBadge, StatusBadge } from "@/components/common/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";
import { relativeTime } from "@/lib/utils";

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  let data;
  try {
    data = await getAgent(db, user.id, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { agent, runs } = data;
  const current = agent.versions.find((v) => v.version === agent.currentVersion);
  const done = runs.filter((r) => r.status === "succeeded" || r.status === "failed");
  const successRate = done.length
    ? Math.round((done.filter((r) => r.status === "succeeded").length / done.length) * 100)
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={agent.name}
        description={agent.description}
        actions={<StatusBadge status={agent.status} />}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Current configuration (v{agent.currentVersion})</CardTitle>
          </CardHeader>
          <CardContent>
            {current ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
                <Field
                  label="Model"
                  value={<code className="font-mono text-xs">{current.model}</code>}
                />
                <Field
                  label="Output contract"
                  value={<code className="font-mono text-xs">{current.outputSchemaKey}</code>}
                />
                <Field
                  label="Assigned business"
                  value={agent.business?.name ?? "Shared (all workspaces)"}
                />
                <Field label="Max output tokens" value={current.maxOutputTokens.toLocaleString()} />
                <Field label="Budget per run" value={formatUsd(Number(current.budgetUsdPerRun))} />
                <Field label="Timeout" value={formatDuration(current.timeoutMs)} />
                <Field label="Max attempts" value={current.maxAttempts} />
                <Field
                  label="Tools"
                  value={
                    current.allowedTools.length
                      ? current.allowedTools.join(", ")
                      : "None (analysis only)"
                  }
                />
                <Field label="Permissions" value={current.permissions.join(", ") || "None"} />
              </dl>
            ) : (
              <p className="text-sm text-danger">Current version record missing.</p>
            )}
            {current && (
              <details className="mt-5">
                <summary className="cursor-pointer text-sm font-medium">
                  System instructions
                </summary>
                <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-surface-2 p-3 font-mono text-xs whitespace-pre-wrap">
                  {current.systemPrompt}
                </pre>
              </details>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Performance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Runs (latest 50)" value={runs.length} />
            <Row label="Success rate" value={successRate == null ? "—" : `${successRate}%`} />
            <Row
              label="Cost (latest 50)"
              value={formatUsd(runs.reduce((n, r) => n + Number(r.costUsd ?? 0), 0))}
            />
            <div>
              <p className="text-muted-foreground">Version history</p>
              <ul className="mt-1 space-y-1">
                {agent.versions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between text-xs">
                    <span>
                      v{v.version} · {v.changeNote || "No note"}
                    </span>
                    <span className="text-muted-foreground">{relativeTime(v.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Run history</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <EmptyState
              title="No runs yet"
              description="Create a task for this agent to run it."
              action={
                <Link
                  className="text-sm text-primary hover:underline"
                  href={`/tasks/new?agent=${agent.id}`}
                >
                  New task
                </Link>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Task</th>
                    <th className="py-2 pr-4 font-medium">Business</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium">Tokens</th>
                    <th className="py-2 pr-4 font-medium">Cost</th>
                    <th className="py-2 pr-4 font-medium">Duration</th>
                    <th className="py-2 font-medium">Queued</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2 pr-4">
                        <Link href={`/tasks/${r.task.id}`} className="hover:underline">
                          {r.task.title}
                        </Link>
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">{r.business.name}</td>
                      <td className="py-2 pr-4">
                        <span className="flex items-center gap-1.5">
                          <StatusBadge status={r.status} />
                          {r.provider === "mock" && <ProviderBadge provider="mock" />}
                        </span>
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs">
                        {r.inputTokens == null ? "—" : `${r.inputTokens} / ${r.outputTokens}`}
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs">
                        {r.costUsd == null ? "—" : formatUsd(Number(r.costUsd))}
                      </td>
                      <td className="py-2 pr-4 text-xs">{formatDuration(r.durationMs)}</td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {relativeTime(r.queuedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        <Badge className="mr-1">Note</Badge> Editing configuration and creating custom agents arrive
        with the Agent Builder (Milestone 3). Every change will create a new immutable version.
      </p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
