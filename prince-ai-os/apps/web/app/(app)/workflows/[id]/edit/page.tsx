import { notFound, redirect } from "next/navigation";
import { ForbiddenError, NotFoundError, getWorkflow, workflowEditorOptions } from "@prince/core";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { WorkflowEditor } from "@/components/workflows/workflow-editor";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Edit workflow" };

export default async function EditWorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  let view;
  try {
    view = await getWorkflow(db, user.id, id);
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof ForbiddenError) notFound();
    throw e;
  }
  if (!view.canEdit) redirect(`/workflows/${id}`);
  const options = await workflowEditorOptions(db, user.id);
  const { workflow } = view;
  return (
    <div>
      <PageHeader
        title={`Edit ${workflow.name}`}
        description={`${workflow.business.name} · version ${workflow.version}`}
      />
      <Card>
        <CardContent className="pt-5">
          <WorkflowEditor
            businesses={[{ id: workflow.businessId, name: workflow.business.name }]}
            agents={options.agents}
            initial={{
              workflowId: workflow.id,
              version: workflow.version,
              businessId: workflow.businessId,
              name: workflow.name,
              description: workflow.description,
              steps: view.steps.map((s) => ({
                title: s.title,
                agentId: s.agentId,
                instructions: s.instructions,
                dependsOn: s.dependsOn,
                requiresApproval: s.requiresApproval,
              })),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
