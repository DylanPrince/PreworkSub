import { PlannedPage } from "@/components/common/planned-page";
import { navItem } from "@/lib/nav";

export const metadata = { title: "Research Lab" };

export default function Page() {
  return (
    <PlannedPage
      item={navItem("/research")}
      scope={[
        "Saved research briefs per business",
        "Source-backed reports once web tools are enabled",
        "Comparison of opportunities over time",
      ]}
      availableNow={[{ href: "/tasks/new", label: "Run the Market Research Agent" }]}
    />
  );
}
