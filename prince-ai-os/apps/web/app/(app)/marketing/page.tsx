import { PlannedPage } from "@/components/common/planned-page";
import { navItem } from "@/lib/nav";

export const metadata = { title: "Marketing" };

export default function Page() {
  return (
    <PlannedPage
      item={navItem("/marketing")}
      scope={[
        "Campaign planning and audience research",
        "Ad creative and landing page drafts",
        "Spend, conversion and ROAS from connected platforms only",
        "Approval required to launch, raise budgets, publish or delete",
      ]}
      availableNow={[]}
    />
  );
}
