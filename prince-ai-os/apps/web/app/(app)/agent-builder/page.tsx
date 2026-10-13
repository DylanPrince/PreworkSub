import { Plus } from "lucide-react";
import Link from "next/link";
import { listAgents, listManageableBusinesses } from "@prince/core";
import { formatUsd } from "@prince/shared";
import { DuplicateAgentButton } from "@/components/agent-builder/agent-controls";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Agent Builder" };

export default async function AgentBuilderPage() {
  const user = await requireUser();
  const [agents, businesses] = await Promise.all([
    listAgents(db, user.id, { includeArchived: true }),
    listManageableBusinesses(db, user.id),
  ]);
  const custom = agents.filter((a) => a.templateKey === null && a.businessId !== null);
  const builtIn = agents.filter((a) => a.businessId === null && a.executable);
  const live = custom.filter((a) => a.status !== "archived");
  const archived = custom.filter((a) => a.status === "archived");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agent Builder"
        description="Create, configure, test and version specialised agents. Every save is a new immutable version; runs record the version they used."
        actions={
          businesses.length > 0 && (
            <Button asChild>
              <Link href="/agent-builder/new">
                <Plus /> New agent
              </Link>
            </Button>
          )
        }
      />

      {businesses.length === 0 ? (
        <EmptyState
          title="Create a business first"
          description="Custom agents belong to a business you own or administer."
          action={
            <Button asChild>
              <Link href="/businesses/new">Create business</Link>
            </Button>
          }
        />
      ) : (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Your agents</CardTitle>
              <CardDescription>Custom agents across your businesses.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {live.length === 0 ? (
              <EmptyState
                title="No custom agents yet"
                description="Start from scratch or duplicate a built-in agent below."
              />
            ) : (
              <AgentTable agents={live} />
            )}
            {archived.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium">
                  Archived ({archived.length})
                </summary>
                <div className="mt-2">
                  <AgentTable agents={archived} />
                </div>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Start from a built-in agent</CardTitle>
            <CardDescription>
              Built-in agents are read-only. Duplicating copies the current configuration into a
              business, where you can change anything.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {builtIn.map((a) => (
              <li
                key={a.id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <Link href={`/agents/${a.id}`} className="text-sm font-medium hover:underline">
                    {a.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {a.division} · {a.specialization}
                  </p>
                </div>
                <DuplicateAgentButton agentId={a.id} businesses={businesses} />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

type Row = Awaited<ReturnType<typeof listAgents>>[number];

function AgentTable({ agents }: { agents: Row[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="py-2 pr-4 font-medium">Agent</th>
            <th className="py-2 pr-4 font-medium">Business</th>
            <th className="py-2 pr-4 font-medium">Status</th>
            <th className="py-2 pr-4 font-medium">Version</th>
            <th className="py-2 pr-4 font-medium">Model</th>
            <th className="py-2 pr-4 font-medium">Runs</th>
            <th className="py-2 font-medium">Cost</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {agents.map((a) => (
            <tr key={a.id}>
              <td className="py-2 pr-4">
                <Link href={`/agent-builder/${a.id}`} className="font-medium hover:underline">
                  {a.name}
                </Link>
                <p className="text-xs text-muted-foreground">{a.specialization}</p>
              </td>
              <td className="py-2 pr-4 text-muted-foreground">{a.business?.name}</td>
              <td className="py-2 pr-4">
                <StatusBadge status={a.status} />
              </td>
              <td className="py-2 pr-4 font-mono text-xs">v{a.currentVersion}</td>
              <td className="py-2 pr-4 font-mono text-xs">{a.model}</td>
              <td className="py-2 pr-4 font-mono text-xs">{a.stats.total}</td>
              <td className="py-2 font-mono text-xs">{formatUsd(a.stats.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
