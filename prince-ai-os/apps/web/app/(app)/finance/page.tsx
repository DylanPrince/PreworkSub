import { PlannedPage } from "@/components/common/planned-page";
import { navItem } from "@/lib/nav";

export const metadata = { title: "Finance" };

export default function Page() {
  return (
    <PlannedPage
      item={navItem("/finance")}
      scope={[
        "Revenue, COGS, gross profit, operating expenses, net profit",
        "Ad spend, AI API costs and subscriptions",
        "Every record labelled actual, imported, user-entered, estimated or demo",
        "Transparent profitability formulas",
        "Alerts for spend spikes, negative margins and budget overruns",
        "Advisory only: the system never moves money",
      ]}
      availableNow={[{ href: "/", label: "AI operating cost (tracked today)" }]}
    />
  );
}
