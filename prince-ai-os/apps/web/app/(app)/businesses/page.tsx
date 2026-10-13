import { Plus } from "lucide-react";
import Link from "next/link";
import { listBusinesses } from "@prince/core";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Businesses" };

export default async function BusinessesPage() {
  const user = await requireUser();
  const businesses = await listBusinesses(db, user.id);
  return (
    <div>
      <PageHeader
        title="Businesses"
        description="Isolated workspaces for each venture."
        actions={
          <Button asChild>
            <Link href="/businesses/new">
              <Plus /> New business
            </Link>
          </Button>
        }
      />
      {businesses.length === 0 ? (
        <EmptyState
          title="No businesses yet"
          description="Create a workspace to start assigning tasks to agents."
          action={
            <Button asChild>
              <Link href="/businesses/new">Create business</Link>
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {businesses.map((b) => (
            <li key={b.id}>
              <Link href={`/businesses/${b.id}`} className="block h-full">
                <Card className="h-full p-4 transition-colors hover:border-primary/50">
                  <p className="font-medium">{b.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {b.businessModel || "Business model not set"}
                  </p>
                  <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                    {b.description || "No description"}
                  </p>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {b._count.tasks} tasks · {b._count.runs} runs
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
