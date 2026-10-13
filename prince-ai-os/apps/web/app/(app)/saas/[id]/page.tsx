import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import {
  SAAS_STAGES,
  askableAgents,
  getSaasProject,
  preferredAgentId,
  tasksAbout,
} from "@prince/core";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { AgentPanel } from "@/components/modules/agent-panel";
import { toOptions } from "@/components/modules/options";
import {
  BacklogItemForm,
  BacklogStatusSelect,
  EditSaasProjectForm,
} from "@/components/modules/saas-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { orNotFound } from "@/lib/or-not-found";
import { getRunModes } from "@/lib/run-modes";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata = { title: "Software project" };

const GROUPS = [
  { status: "in_progress", label: "In progress" },
  { status: "todo", label: "To do" },
  { status: "done", label: "Done" },
] as const;

export default async function SaasProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { project: p, canEdit } = await orNotFound(getSaasProject(db, user.id, id));
  const [agents, related, modes] = await Promise.all([
    askableAgents(db, p.businessId),
    tasksAbout(db, "saas_project", p.id),
    getRunModes(),
  ]);

  return (
    <div className="space-y-6">
      <Link
        href="/saas"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> SaaS Projects
      </Link>
      <PageHeader
        title={p.name}
        description={[p.business.name, p.summary].filter(Boolean).join(" · ")}
        actions={
          <>
            <StatusBadge status={p.stage} />
            {p.repositoryUrl && (
              <a
                href={p.repositoryUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex items-center gap-1 text-xs text-primary underline"
              >
                Repository <ExternalLink className="size-3.5" aria-hidden />
              </a>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card aria-labelledby="backlog-heading">
            <CardHeader>
              <div>
                <CardTitle id="backlog-heading">Backlog</CardTitle>
                <CardDescription>Sorted by priority, then by when it was added.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {p.items.length === 0 && (
                <p className="text-sm text-muted-foreground">The backlog is empty.</p>
              )}
              {GROUPS.map((g) => {
                const items = p.items.filter((i) => i.status === g.status);
                if (items.length === 0) return null;
                return (
                  <section key={g.status} aria-label={g.label}>
                    <h3 className="mb-1 text-xs font-medium text-muted-foreground">
                      {g.label} ({items.length})
                    </h3>
                    <ul className="divide-y divide-border">
                      {items.map((i) => (
                        <li key={i.id} className="flex items-start justify-between gap-3 py-2">
                          <div className="min-w-0">
                            <p
                              className={cn(
                                "text-sm",
                                i.status === "done" && "text-muted-foreground line-through",
                              )}
                            >
                              {i.title}
                            </p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                              <Badge
                                tone={
                                  i.priority === "high"
                                    ? "danger"
                                    : i.priority === "medium"
                                      ? "warning"
                                      : "neutral"
                                }
                              >
                                {i.priority}
                              </Badge>
                              {i.type}
                              {i.details && <span className="line-clamp-1">· {i.details}</span>}
                            </p>
                          </div>
                          {canEdit ? (
                            <BacklogStatusSelect itemId={i.id} status={i.status} title={i.title} />
                          ) : (
                            <StatusBadge status={i.status} />
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
              {canEdit && (
                <div className="border-t border-border pt-4">
                  <BacklogItemForm projectId={p.id} />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{canEdit ? "Edit project" : "Requirements"}</CardTitle>
            </CardHeader>
            <CardContent>
              {canEdit ? (
                <EditSaasProjectForm
                  id={p.id}
                  stages={toOptions(SAAS_STAGES)}
                  defaults={{
                    name: p.name,
                    summary: p.summary,
                    stage: p.stage,
                    repositoryUrl: p.repositoryUrl,
                    requirements: p.requirements,
                  }}
                />
              ) : (
                <p className="text-sm whitespace-pre-wrap">{p.requirements || "—"}</p>
              )}
            </CardContent>
          </Card>
        </div>

        <AgentPanel
          subjectType="saas_project"
          subjectId={p.id}
          agents={agents}
          defaultAgentId={preferredAgentId(agents, "executive-coordinator")}
          suggestions={[
            "Turn the requirements into a prioritised build plan with milestones.",
            "Review the open backlog and say what should ship first and why.",
            "List the questions to answer before building this.",
          ]}
          modes={modes}
          tasks={related}
          canAsk={canEdit}
          description="The agent reads the requirements and open backlog. It plans and advises; it does not write or deploy code."
        />
      </div>
    </div>
  );
}
