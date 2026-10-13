import { PlannedPage } from "@/components/common/planned-page";
import { navItem } from "@/lib/nav";

export const metadata = { title: "SaaS Projects" };

export default function Page() {
  return (
    <PlannedPage
      item={navItem("/saas")}
      scope={[
        "Ideas, requirements and specifications",
        "Backlog and development tasks",
        "Repository, build, test and deployment status",
        "Approval required for production deployments",
      ]}
      availableNow={[]}
    />
  );
}
