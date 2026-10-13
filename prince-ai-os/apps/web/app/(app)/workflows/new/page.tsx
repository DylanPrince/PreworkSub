import { redirect } from "next/navigation";
import { workflowEditorOptions } from "@prince/core";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { WorkflowEditor } from "@/components/workflows/workflow-editor";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";

export const metadata = { title: "New workflow" };

export default async function NewWorkflowPage() {
  const user = await requireUser();
  const options = await workflowEditorOptions(db, user.id);
  if (options.businesses.length === 0) redirect("/workflows");
  return (
    <div>
      <PageHeader
        title="New workflow"
        description="Chain agents into a procedure. Nothing runs until you start a run."
      />
      <Card>
        <CardContent className="pt-5">
          <WorkflowEditor businesses={options.businesses} agents={options.agents} />
        </CardContent>
      </Card>
    </div>
  );
}
