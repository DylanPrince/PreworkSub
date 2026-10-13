import Link from "next/link";
import { Suspense } from "react";
import { SAAS_STAGES, listBusinesses, listSaasProjects, writableBusinesses } from "@prince/core";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { toOptions } from "@/components/modules/options";
import { NewSaasProjectForm } from "@/components/modules/saas-forms";
import { OverviewFilters } from "@/components/overview/filters";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";

export const metadata = { title: "SaaS Projects" };

export default async function SaasPage({
  searchParams,
}: {
  searchParams: Promise<{ business?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const [businesses, writable] = await Promise.all([
    listBusinesses(db, user.id),
    writableBusinesses(db, user.id),
  ]);
  const scoped = businesses.find((b) => b.id === sp.business);
  const projects = await listSaasProjects(db, user.id, { businessId: scoped?.id });
  const multi = businesses.length > 1 && !scoped;

  return (
    <div className="space-y-6">
      <PageHeader
        title="SaaS Projects"
        description="Software projects with requirements and a prioritised backlog. Agents help write specs and plans; no code host is connected, so nothing is built or deployed from here."
        actions={
          businesses.length > 1 && (
            <Suspense>
              <OverviewFilters
                businesses={businesses.map((b) => ({ id: b.id, name: b.name }))}
                ranges={[]}
              />
            </Suspense>
          )
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Projects</CardTitle>
        </CardHeader>
        <CardContent>
          {projects.length === 0 ? (
            <EmptyState title="No projects yet" description="Add one below." />
          ) : (
            <ul className="divide-y divide-border">
              {projects.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <Link href={`/saas/${p.id}`} className="text-sm font-medium hover:underline">
                      {p.name}
                    </Link>
                    <p className="line-clamp-1 text-xs text-muted-foreground">
                      {[multi && p.business.name, p.summary].filter(Boolean).join(" · ") ||
                        "No summary"}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      {p.backlog.todo} to do · {p.backlog.inProgress} in progress · {p.backlog.done}{" "}
                      done
                    </span>
                    <StatusBadge status={p.stage} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="max-w-3xl">
        <CardHeader>
          <div>
            <CardTitle>New project</CardTitle>
            <CardDescription>
              Requirements can start rough; agents can help refine them.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {writable.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {businesses.length === 0
                ? "Create a business first."
                : "Viewers can read projects but not add them."}
            </p>
          ) : (
            <NewSaasProjectForm
              businesses={writable.map((b) => ({ value: b.id, label: b.name }))}
              stages={toOptions(SAAS_STAGES)}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
