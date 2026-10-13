import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { getCalendar, listBusinesses, type CalendarEvent } from "@prince/core";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { OverviewFilters } from "@/components/overview/filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Calendar" };

const KINDS: Record<
  CalendarEvent["kind"],
  { label: string; tone: "primary" | "info" | "warning" | "neutral" | "success" }
> = {
  content: { label: "Content", tone: "primary" },
  campaign_start: { label: "Campaign", tone: "success" },
  campaign_end: { label: "Campaign", tone: "neutral" },
  approval_expiry: { label: "Approval", tone: "warning" },
  workflow_run: { label: "Workflow", tone: "info" },
};

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ business?: string; month?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const businesses = await listBusinesses(db, user.id);
  const scoped = businesses.find((b) => b.id === sp.business);
  const cal = await getCalendar(db, user.id, { month: sp.month, businessId: scoped?.id });
  const monthName = cal.start.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const link = (month: string) =>
    `/calendar?${new URLSearchParams({ month, ...(scoped ? { business: scoped.id } : {}) })}`;
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of cal.events) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  const today = new Date().toISOString().slice(0, 10);
  const multi = businesses.length > 1 && !scoped;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendar"
        description="Dated records across your businesses: planned publication dates, campaign dates, approval deadlines and workflow runs. Recurring schedules are not built yet."
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

      <nav aria-label="Month" className="flex items-center justify-between gap-2">
        <Button asChild size="sm" variant="secondary">
          <Link href={link(cal.previous)} aria-label="Previous month">
            <ChevronLeft /> <span className="hidden sm:inline">Previous</span>
          </Link>
        </Button>
        <h2 className="text-base font-semibold" aria-live="polite">
          {monthName}
        </h2>
        <Button asChild size="sm" variant="secondary">
          <Link href={link(cal.next)} aria-label="Next month">
            <span className="hidden sm:inline">Next</span> <ChevronRight />
          </Link>
        </Button>
      </nav>

      {cal.events.length === 0 ? (
        <EmptyState
          title={`Nothing dated in ${monthName}`}
          description="Approved content with a publication date, campaigns with dates, pending approvals and workflow runs appear here."
        />
      ) : (
        <ol className="space-y-3" aria-label={`Events in ${monthName}`}>
          {[...byDay.entries()].map(([date, events]) => (
            <li key={date}>
              <Card>
                <CardContent className="flex flex-col gap-3 pt-4 sm:flex-row sm:gap-6">
                  <h3 className="w-28 shrink-0 text-sm font-semibold">
                    <time dateTime={date}>
                      {new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        timeZone: "UTC",
                      })}
                    </time>
                    {date === today && (
                      <Badge tone="primary" className="ml-2">
                        Today
                      </Badge>
                    )}
                  </h3>
                  <ul className="min-w-0 flex-1 space-y-2">
                    {events.map((e) => (
                      <li
                        key={`${e.kind}-${e.href}`}
                        className="flex flex-wrap items-center justify-between gap-2"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Badge tone={KINDS[e.kind].tone}>{KINDS[e.kind].label}</Badge>
                          <Link href={e.href} className="truncate text-sm hover:underline">
                            {e.title}
                          </Link>
                          {multi && (
                            <span className="hidden text-xs text-muted-foreground sm:inline">
                              {e.business}
                            </span>
                          )}
                        </span>
                        <StatusBadge status={e.status} />
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
