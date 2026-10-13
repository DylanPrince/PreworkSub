import Link from "next/link";
import { listAgents, listBusinesses } from "@prince/core";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { TaskForm } from "@/components/tasks/task-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";

export const metadata = { title: "New task" };

export default async function NewTaskPage({
  searchParams,
}: {
  searchParams: Promise<{ business?: string; agent?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const [businesses, agents] = await Promise.all([
    listBusinesses(db, user.id),
    listAgents(db, user.id),
  ]);
  return (
    <div>
      <PageHeader
        title="New task"
        description="Assign work to an agent. Runs execute in the background worker and every attempt is recorded."
      />
      {businesses.length === 0 ? (
        <EmptyState
          title="Create a business first"
          description="Tasks always belong to a business workspace."
          action={
            <Button asChild>
              <Link href="/businesses/new">Create business</Link>
            </Button>
          }
        />
      ) : (
        <Card>
          <CardContent className="pt-5">
            <TaskForm
              businesses={businesses.map((b) => ({ id: b.id, name: b.name }))}
              agents={agents
                .filter((a) => a.status === "active")
                .map((a) => ({
                  id: a.id,
                  name: a.name,
                  businessId: a.businessId,
                  executable: a.executable,
                }))}
              defaultBusinessId={sp.business}
              defaultAgentId={sp.agent}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
