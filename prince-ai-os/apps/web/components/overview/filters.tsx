"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/input";

const RANGE_LABELS: Record<number, string> = {
  7: "Last 7 days",
  14: "Last 14 days",
  30: "Last 30 days",
  90: "Last 90 days",
  365: "Last 12 months",
};

/** Business and date-range filters kept in the URL (?business=&days=). No ranges: business only. */
export function OverviewFilters({
  businesses,
  ranges = [7, 14, 30, 90],
  defaultDays = 14,
}: {
  businesses: { id: string; name: string }[];
  ranges?: number[];
  defaultDays?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`);
  };
  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor="f-business">
        Business
      </label>
      <Select
        id="f-business"
        className="w-44"
        value={params.get("business") ?? ""}
        onChange={(e) => set("business", e.target.value)}
      >
        <option value="">All businesses</option>
        {businesses.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </Select>
      {ranges.length > 0 && (
        <>
          <label className="sr-only" htmlFor="f-days">
            Date range
          </label>
          <Select
            id="f-days"
            className="w-32"
            value={params.get("days") ?? String(defaultDays)}
            onChange={(e) => set("days", e.target.value)}
          >
            {ranges.map((d) => (
              <option key={d} value={d}>
                {RANGE_LABELS[d] ?? `Last ${d} days`}
              </option>
            ))}
          </Select>
        </>
      )}
    </div>
  );
}
