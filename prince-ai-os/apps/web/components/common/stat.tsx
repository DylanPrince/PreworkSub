import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { DataSource } from "@prince/shared";
import { DATA_SOURCE_LABELS } from "@prince/shared";

/** KPI tile. A null value renders as "Not tracked yet" rather than a misleading zero. */
export function Stat({
  label,
  value,
  hint,
  source,
  icon,
}: {
  label: string;
  value: ReactNode | null;
  hint?: string;
  source?: DataSource | "not_tracked";
  icon?: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {icon}
          {label}
        </p>
        {source && source !== "actual" && (
          <Badge
            tone={source === "not_tracked" ? "neutral" : source === "demo" ? "warning" : "info"}
          >
            {source === "not_tracked" ? "Not tracked" : DATA_SOURCE_LABELS[source]}
          </Badge>
        )}
      </div>
      <p className="font-mono text-2xl font-semibold tracking-tight tabular-nums">
        {value === null ? (
          <span className="text-base font-normal text-muted-foreground">Not tracked yet</span>
        ) : (
          value
        )}
      </p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </Card>
  );
}
