import { PlannedPage } from "@/components/common/planned-page";
import { navItem } from "@/lib/nav";

export const metadata = { title: "Analytics" };

export default function Page() {
  return (
    <PlannedPage
      item={navItem("/analytics")}
      scope={[
        "Date and business filters with drill-down",
        "Workflow success rates and agent utilization",
        "Business KPI trends from tracked records",
      ]}
      availableNow={[{ href: "/", label: "Overview: AI cost, tokens, run outcomes and latency" }]}
    />
  );
}
