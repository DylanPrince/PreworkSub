import { PlannedPage } from "@/components/common/planned-page";
import { navItem } from "@/lib/nav";

export const metadata = { title: "Workflows" };

export default function Page() {
  return (
    <PlannedPage
      item={navItem("/workflows")}
      scope={[
        "Visual node editor (trigger, agent, condition, approval, delay, notify, output)",
        "Manual, scheduled and webhook triggers",
        "Server-side graph validation before execution",
        "Versioning, execution logs and rollback",
        "Loop limits: depth, tool calls, time, tokens and spend",
      ]}
      availableNow={[]}
    />
  );
}
