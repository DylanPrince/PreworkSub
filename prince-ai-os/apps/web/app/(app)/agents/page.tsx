import Link from "next/link";
import { AGENT_TEMPLATES } from "@prince/agents";
import { listAgents } from "@prince/core";
import { formatUsd } from "@prince/shared";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Agent Workforce" };

export default async function AgentsPage() {
  const user = await requireUser();
  const agents = await listAgents(db, user.id);
  const instantiated = new Set(agents.map((a) => a.templateKey));
  const planned = AGENT_TEMPLATES.filter((t) => !t.implemented && !instantiated.has(t.key));
  const divisions = [...new Set(AGENT_TEMPLATES.map((t) => t.division))];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Agent Workforce"
        description="Application-managed AI agents with versioned configuration, budgets and run history. Planned agents are defined in the registry but cannot run yet."
      />
      {divisions.map((division) => {
        const live = agents.filter((a) => a.division === division);
        const soon = planned.filter((t) => t.division === division);
        return (
          <section key={division} aria-labelledby={`div-${division}`}>
            <h2
              id={`div-${division}`}
              className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
            >
              {division} division
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {live.map((a) => (
                <li key={a.id}>
                  <Link href={`/agents/${a.id}`} className="block h-full">
                    <Card className="h-full p-4 transition-colors hover:border-primary/50">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium">{a.name}</p>
                        <StatusBadge status={a.status} />
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {a.specialization} · v{a.currentVersion} ·{" "}
                        {a.business ? a.business.name : "Shared"}
                      </p>
                      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                        {a.description}
                      </p>
                      <p className="mt-3 text-xs text-muted-foreground">
                        {a.stats.total} runs · {a.stats.succeeded} ok · {a.stats.failed} failed ·{" "}
                        {formatUsd(a.stats.costUsd)}
                      </p>
                    </Card>
                  </Link>
                </li>
              ))}
              {soon.map((t) => (
                <li key={t.key}>
                  <Card className="h-full border-dashed bg-transparent p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">{t.name}</p>
                      <Badge>Planned</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t.specialization}</p>
                    <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                      {t.description}
                    </p>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
