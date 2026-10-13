import { PlannedPage } from "@/components/common/planned-page";
import { navItem } from "@/lib/nav";

export const metadata = { title: "Calendar" };

export default function Page() {
  return (
    <PlannedPage
      item={navItem("/calendar")}
      scope={[
        "Scheduled and recurring jobs",
        "Workflow schedules",
        "Content publication dates (draft only until approved)",
      ]}
      availableNow={[]}
    />
  );
}
