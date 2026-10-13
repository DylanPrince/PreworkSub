import { PlannedPage } from "@/components/common/planned-page";
import { navItem } from "@/lib/nav";

export const metadata = { title: "Agent Builder" };

export default function Page() {
  return (
    <PlannedPage
      item={navItem("/agent-builder")}
      scope={[
        "Name, description, specialization and instructions",
        "Model, tools and permission selection",
        "Token, dollar, runtime and retry limits",
        "Output schema definition",
        "Sandbox test runs on sample inputs",
        "Save as a new immutable version, enable or disable",
      ]}
      availableNow={[{ href: "/agents", label: "Agent registry and version history" }]}
    />
  );
}
