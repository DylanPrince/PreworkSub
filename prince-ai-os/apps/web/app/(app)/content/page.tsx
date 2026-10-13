import Link from "next/link";
import { Suspense } from "react";
import {
  CONTENT_FORMATS,
  CONTENT_STAGES,
  listBusinesses,
  listContent,
  writableBusinesses,
} from "@prince/core";
import { PageHeader } from "@/components/common/page-header";
import { NewContentForm } from "@/components/modules/content-forms";
import { humanize, toOptions } from "@/components/modules/options";
import { OverviewFilters } from "@/components/overview/filters";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Content Studio" };

const STAGE_HINTS: Record<string, string> = {
  idea: "Topics to develop",
  drafting: "Being written",
  review: "Ready for an approver",
  approved: "Cleared to publish",
  published: "Recorded as live",
};

export default async function ContentPage({
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
  const items = await listContent(db, user.id, { businessId: scoped?.id });
  const multi = businesses.length > 1 && !scoped;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Content Studio"
        description="Plan, draft and approve posts, emails, videos and ads. Approval clears the exact text for publishing; no publishing account is connected, so a person posts it and records the link."
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

      <section
        aria-label="Content pipeline"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
      >
        {CONTENT_STAGES.map((stage) => {
          const inStage = items.filter((i) => i.stage === stage);
          return (
            <Card key={stage} aria-labelledby={`stage-${stage}`} className="flex flex-col">
              <CardHeader className="pb-2">
                <div>
                  <CardTitle id={`stage-${stage}`}>
                    {humanize(stage)}{" "}
                    <span className="font-normal text-muted-foreground">({inStage.length})</span>
                  </CardTitle>
                  <CardDescription>{STAGE_HINTS[stage]}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="flex-1">
                {inStage.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nothing here.</p>
                ) : (
                  <ul className="space-y-2">
                    {inStage.map((i) => (
                      <li key={i.id} className="rounded-lg border border-border p-2.5">
                        <Link
                          href={`/content/${i.id}`}
                          className="line-clamp-2 text-sm font-medium hover:underline"
                        >
                          {i.title}
                        </Link>
                        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          {humanize(i.format)}
                          {i.channel && <span>· {i.channel}</span>}
                          {multi && <span>· {i.business.name}</span>}
                        </p>
                        {(i.scheduledFor || i.pendingApprovalId) && (
                          <p className="mt-1.5 flex flex-wrap gap-1.5">
                            {i.scheduledFor && (
                              <Badge tone="info">{i.scheduledFor.toISOString().slice(0, 10)}</Badge>
                            )}
                            {i.pendingApprovalId && <Badge tone="warning">Awaiting approval</Badge>}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </section>

      <Card className="max-w-3xl">
        <CardHeader>
          <div>
            <CardTitle>New content idea</CardTitle>
            <CardDescription>
              Start with a title and brief; write the text yourself or ask the Copywriting agent.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {writable.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {businesses.length === 0
                ? "Create a business first."
                : "Viewers can read content but not add it."}
            </p>
          ) : (
            <NewContentForm
              businesses={writable.map((b) => ({ value: b.id, label: b.name }))}
              formats={toOptions(CONTENT_FORMATS)}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
