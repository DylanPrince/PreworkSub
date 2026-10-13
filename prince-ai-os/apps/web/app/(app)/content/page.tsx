import { PlannedPage } from "@/components/common/planned-page";
import { navItem } from "@/lib/nav";

export const metadata = { title: "Content Studio" };

export default function Page() {
  return (
    <PlannedPage
      item={navItem("/content")}
      scope={[
        "Idea, research, script, storyboard, assets, review, approval, schedule, publish",
        "Content calendar and asset library",
        "Platform selection and publishing queue",
        "Generation providers shown as unavailable until connected",
        "Policy, licensing and disclosure checks",
      ]}
      availableNow={[]}
    />
  );
}
