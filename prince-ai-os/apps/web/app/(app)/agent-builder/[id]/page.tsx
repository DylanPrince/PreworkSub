import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getContract } from "@prince/agents";
import {
  ForbiddenError,
  NotFoundError,
  getAgentForBuilder,
  listManageableBusinesses,
} from "@prince/core";
import { formatUsd } from "@prince/shared";
import {
  AgentStatusControls,
  RestoreVersionButton,
  TestAgentPanel,
} from "@/components/agent-builder/agent-controls";
import { AgentForm } from "@/components/agent-builder/agent-form";
import { PageHeader } from "@/components/common/page-header";
import { ProviderBadge, StatusBadge } from "@/components/common/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getBuilderOptions } from "@/lib/agent-builder";
import { getRunModes } from "@/lib/run-modes";
import { db, env } from "@/lib/server";
import { requireUser } from "@/lib/session";
import { relativeTime } from "@/lib/utils";

export const metadata = { title: "Manage agent" };

export default async function ManageAgentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  let data;
  try {
    data = await getAgentForBuilder(db, user.id, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    // Built-in agents (and agents in businesses the user cannot administer) are read-only.
    if (e instanceof ForbiddenError) redirect(`/agents/${id}`);
    throw e;
  }
  const { agent, business, versions, current, tests } = data;
  const [options, modes, businesses] = await Promise.all([
    getBuilderOptions(),
    getRunModes(),
    listManageableBusinesses(db, user.id),
  ]);
  const testBusinesses = businesses.filter((b) => b.id === business.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title={agent.name}
        description={`${business.name} · v${agent.currentVersion} · ${getContract(current.outputSchemaKey)?.label ?? current.outputSchemaKey}`}
        actions={
          <>
            <StatusBadge status={agent.status} />
            <AgentStatusControls agentId={agent.id} status={agent.status} />
          </>
        }
      />
      {agent.status !== "active" && (
        <p
          role="status"
          className="rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-warning"
        >
          This agent is {agent.status}. It cannot be assigned tasks or run until you enable it.
        </p>
      )}
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Configuration</CardTitle>
              <CardDescription>
                Saving creates v{agent.currentVersion + 1}. Runs already queued keep the version
                they started with.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <AgentForm
              mode={{ kind: "edit", agentId: agent.id, currentVersion: agent.currentVersion }}
              initial={{
                name: agent.name,
                description: agent.description,
                specialization: agent.specialization,
                division: agent.division,
                instructions: current.systemPrompt,
                model: current.model,
                outputSchemaKey: current.outputSchemaKey,
                maxOutputTokens: current.maxOutputTokens,
                budgetUsdPerRun: Number(current.budgetUsdPerRun),
                timeoutSeconds: Math.round(current.timeoutMs / 1000),
                maxAttempts: current.maxAttempts,
                effort: current.effort ?? "",
              }}
              {...options}
              dailyLimitUsd={env.AI_DAILY_BUDGET_USD}
            />
          </CardContent>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Test this agent</CardTitle>
                <CardDescription>
                  Runs v{agent.currentVersion} on a sample task. Saved as a test task with full run
                  history.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <TestAgentPanel
                agentId={agent.id}
                businesses={testBusinesses}
                modes={modes}
                disabled={agent.status !== "active"}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Recent tests</CardTitle>
            </CardHeader>
            <CardContent>
              {tests.length === 0 ? (
                <p className="text-sm text-muted-foreground">No test runs yet.</p>
              ) : (
                <ul className="space-y-2">
                  {tests.map((t) => {
                    const r = t.runs[0];
                    return (
                      <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
                        <Link href={`/tasks/${t.id}`} className="truncate hover:underline">
                          {t.title}
                        </Link>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {r && <StatusBadge status={r.status} />}
                          {r && <ProviderBadge provider={r.provider} />}
                          {r?.costUsd != null && (
                            <span className="font-mono text-xs">
                              {formatUsd(Number(r.costUsd))}
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Version history</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2">
                {versions.map((v) => (
                  <li key={v.id} className="flex items-start justify-between gap-2 text-sm">
                    <div>
                      <p className="font-medium">
                        v{v.version}{" "}
                        {v.version === agent.currentVersion && (
                          <Badge tone="primary">current</Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {v.changeNote || "No note"} · <code className="font-mono">{v.model}</code> ·{" "}
                        {relativeTime(v.createdAt)}
                      </p>
                    </div>
                    {v.version !== agent.currentVersion && (
                      <RestoreVersionButton agentId={agent.id} version={v.version} />
                    )}
                  </li>
                ))}
              </ol>
              <Link
                href={`/agents/${agent.id}`}
                className="mt-3 inline-block text-sm text-primary hover:underline"
              >
                Full run history
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
