import { Plus } from "lucide-react";
import Link from "next/link";
import { listTasks } from "@prince/core";
import { formatUsd } from "@prince/shared";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ProviderBadge, StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";
import { relativeTime } from "@/lib/utils";

export const metadata = { title: "Tasks" };

export default async function TasksPage() {
  const user = await requireUser();
  const tasks = await listTasks(db, user.id);
  return (
    <div>
      <PageHeader
        title="Tasks"
        description="Work assigned to agents across your businesses."
        actions={
          <Button asChild>
            <Link href="/tasks/new">
              <Plus /> New task
            </Link>
          </Button>
        }
      />
      {tasks.length === 0 ? (
        <EmptyState title="No tasks yet" description="Create a task to run your first agent." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Task</th>
                <th className="px-4 py-2.5 font-medium">Business</th>
                <th className="px-4 py-2.5 font-medium">Agent</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Last run cost</th>
                <th className="px-4 py-2.5 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tasks.map((t) => {
                const last = t.runs[0];
                return (
                  <tr key={t.id} className="hover:bg-surface-2/50">
                    <td className="px-4 py-2.5">
                      <Link href={`/tasks/${t.id}`} className="font-medium hover:underline">
                        {t.title}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{t.business.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{t.agent.name}</td>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-1.5">
                        <StatusBadge status={t.status} />
                        {last?.provider === "mock" && <ProviderBadge provider="mock" />}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">
                      {last?.costUsd != null ? formatUsd(Number(last.costUsd)) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {relativeTime(t.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
