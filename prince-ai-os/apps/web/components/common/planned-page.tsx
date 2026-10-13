import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "./page-header";
import type { NavItem } from "@/lib/nav";

/**
 * Honest placeholder for sections scheduled in a later milestone. Shows scope, never sample data.
 */
export function PlannedPage({
  item,
  scope,
  availableNow,
}: {
  item: NavItem;
  scope: string[];
  availableNow?: { href: string; label: string }[];
}) {
  return (
    <div>
      <PageHeader
        title={item.label}
        description={item.summary}
        actions={<Badge tone="neutral">Planned · Milestone {item.milestone}</Badge>}
      />
      <Card>
        <CardContent className="pt-5">
          <p className="text-sm">
            This section is not built yet. Nothing on this page is simulated: it will show live data
            once its milestone ships.
          </p>
          <h2 className="mt-5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Planned scope
          </h2>
          <ul className="mt-2 grid gap-1.5 text-sm sm:grid-cols-2">
            {scope.map((s) => (
              <li key={s} className="flex gap-2">
                <span
                  aria-hidden
                  className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground"
                />
                {s}
              </li>
            ))}
          </ul>
          {availableNow && availableNow.length > 0 && (
            <>
              <h2 className="mt-5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Available now
              </h2>
              <ul className="mt-2 flex flex-wrap gap-2">
                {availableNow.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="text-sm text-primary underline-offset-4 hover:underline"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-5 text-xs text-muted-foreground">
            See <code className="font-mono">docs/implementation-plan.md</code> for the delivery
            order.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
