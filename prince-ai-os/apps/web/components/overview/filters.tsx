"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/input";

export function OverviewFilters({ businesses }: { businesses: { id: string; name: string }[] }) {
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
      <label className="sr-only" htmlFor="f-days">
        Date range
      </label>
      <Select
        id="f-days"
        className="w-32"
        value={params.get("days") ?? "14"}
        onChange={(e) => set("days", e.target.value)}
      >
        <option value="7">Last 7 days</option>
        <option value="14">Last 14 days</option>
        <option value="30">Last 30 days</option>
        <option value="90">Last 90 days</option>
      </Select>
    </div>
  );
}
