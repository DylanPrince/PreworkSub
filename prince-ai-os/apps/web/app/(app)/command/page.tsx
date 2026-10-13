import { PlannedPage } from "@/components/common/planned-page";
import { navItem } from "@/lib/nav";

export const metadata = { title: "AI Command Center" };

export default function Page() {
  return (
    <PlannedPage
      item={navItem("/command")}
      scope={[
        "Chat history with business context selection",
        "Request interpretation and agent/workflow routing",
        "Proposed execution plan with cost estimate",
        "Approval requests for consequential actions",
        "Dispatch to the same execution service Tasks use today",
        "Live progress, tool activity, outputs, cancellation and retries",
      ]}
      availableNow={[
        { href: "/tasks/new", label: "Run an agent on a task" },
        { href: "/tasks", label: "Task history" },
      ]}
    />
  );
}
