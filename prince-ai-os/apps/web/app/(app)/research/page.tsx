import { FlaskConical, Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { RESEARCH_SCHEMA_KEY, listAgents, listBusinesses, listResearch } from "@prince/core";
import { formatUsd } from "@prince/shared";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ProviderBadge } from "@/components/common/status-badge";
import { OverviewFilters } from "@/components/overview/filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";
import { relativeTime } from "@/lib/utils";

export const metadata = { title: "Research Lab" };

export default async function ResearchPage({
  searchParams,
}: {
  searchParams: Promise<{ business?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const [businesses, agents] = await Promise.all([
    listBusinesses(db, user.id),
    listAgents(db, user.id),
  ]);
  const scoped = businesses.find((b) => b.id === sp.business);
  const briefs = await listResearch(db, user.id, { businessId: scoped?.id });
  const researcher = agents.find(
    (a) => a.status === "active" && a.outputSchemaKey === RESEARCH_SCHEMA_KEY,
  );
  const newHref = `/tasks/new?${new URLSearchParams({
    ...(researcher ? { agent: researcher.id } : {}),
    ...(scoped ? { business: scoped.id } : {}),
  }).toString()}`;
  const multi = businesses.length > 1 && !scoped;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Research Lab"
        description="Research briefs from agents that produce them. Agents have no live web access yet, so every claim says what it rests on and which ones need checking before you act."
        actions={
          <>
            {businesses.length > 1 && (
              <Suspense>
                <OverviewFilters
                  businesses={businesses.map((b) => ({ id: b.id, name: b.name }))}
                  ranges={[]}
                />
              </Suspense>
            )}
            {businesses.length > 0 && (
              <Button asChild>
                <Link href={newHref}>
                  <Plus /> New research
                </Link>
              </Button>
            )}
          </>
        }
      />

      {briefs.length === 0 ? (
        <EmptyState
          title="No research briefs yet"
          description="Ask the Market Research agent a question, or use “Ask an agent” on a product. Finished briefs collect here."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-label="Research briefs">
          {briefs.map((b) => (
            <li key={b.runId}>
              <Card className="flex h-full flex-col">
                <CardHeader className="pb-2">
                  <div className="min-w-0">
                    <Link
                      href={`/tasks/${b.taskId}`}
                      className="line-clamp-2 text-sm font-semibold hover:underline"
                    >
                      {b.question ?? b.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {[multi && b.business.name, b.agentName, relativeTime(b.finishedAt)]
                        .filter(Boolean)
                        .join(" · ")}
                      {b.costUsd != null && ` · ${formatUsd(b.costUsd, { precise: true })}`}
                    </p>
                  </div>
                  <ProviderBadge provider={b.provider} />
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-3 text-sm">
                  {b.summary ? (
                    <p className="line-clamp-4">{b.summary}</p>
                  ) : (
                    <p className="text-muted-foreground">
                      This run&apos;s output does not match the research format.
                    </p>
                  )}
                  {b.opportunities.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Opportunities</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5">
                        {b.opportunities.slice(0, 3).map((o) => (
                          <li key={o} className="line-clamp-2">
                            {o}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="mt-auto flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <FlaskConical className="size-3.5" aria-hidden />
                    {b.findings} finding{b.findings === 1 ? "" : "s"}
                    {b.needsVerification > 0 && (
                      <Badge tone="warning">{b.needsVerification} need checking</Badge>
                    )}
                  </p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
