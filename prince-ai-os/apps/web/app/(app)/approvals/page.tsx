import { PlannedPage } from "@/components/common/planned-page";
import { navItem } from "@/lib/nav";

export const metadata = { title: "Approvals" };

export default function Page() {
  return (
    <PlannedPage
      item={navItem("/approvals")}
      scope={[
        "Action, requesting agent, business and risk class",
        "Estimated cost and the exact proposed action",
        "Approve or reject with expiry",
        "Enforced in the backend; a denied action cannot be re-requested through another agent",
        "Audit record for every decision",
      ]}
      availableNow={[{ href: "/activity", label: "Activity log" }]}
    />
  );
}
