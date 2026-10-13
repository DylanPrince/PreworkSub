import { listAuditEvents } from "@prince/core";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Activity Logs" };

export default async function ActivityPage() {
  const user = await requireUser();
  const events = await listAuditEvents(db, user.id, { take: 200 });
  return (
    <div>
      <PageHeader
        title="Activity Logs"
        description="Append-only audit trail of user, agent and system actions in your workspaces (latest 200)."
      />
      {events.length === 0 ? (
        <EmptyState title="No activity yet" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Time (UTC)</th>
                <th className="px-4 py-2.5 font-medium">Actor</th>
                <th className="px-4 py-2.5 font-medium">Action</th>
                <th className="px-4 py-2.5 font-medium">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-2 font-mono text-xs whitespace-nowrap text-muted-foreground">
                    {e.createdAt.toISOString().replace("T", " ").slice(0, 19)}
                  </td>
                  <td className="px-4 py-2">
                    <Badge
                      tone={
                        e.actorType === "agent"
                          ? "primary"
                          : e.actorType === "system"
                            ? "info"
                            : "neutral"
                      }
                    >
                      {e.actorType}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{e.action}</td>
                  <td className="px-4 py-2">{e.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
