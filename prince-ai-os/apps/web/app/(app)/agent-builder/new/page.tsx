import { redirect } from "next/navigation";
import { listManageableBusinesses } from "@prince/core";
import { AgentForm } from "@/components/agent-builder/agent-form";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getBuilderOptions } from "@/lib/agent-builder";
import { db, env } from "@/lib/server";
import { requireUser } from "@/lib/session";

export const metadata = { title: "New agent" };

export default async function NewAgentPage({
  searchParams,
}: {
  searchParams: Promise<{ business?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const [businesses, options] = await Promise.all([
    listManageableBusinesses(db, user.id),
    getBuilderOptions(),
  ]);
  if (businesses.length === 0) redirect("/agent-builder");
  const defaultModel =
    options.models.find((m) => m.id === env.AI_DEFAULT_MODEL)?.id ?? options.models[0]?.id ?? "";
  return (
    <div>
      <PageHeader
        title="New agent"
        description="Configure a specialised agent. You can test it with a free dry run or a paid Claude run after saving."
      />
      <Card>
        <CardContent className="pt-5">
          <AgentForm
            mode={{
              kind: "create",
              businesses,
              defaultBusinessId: businesses.some((b) => b.id === sp.business)
                ? sp.business
                : undefined,
            }}
            initial={{
              name: "",
              description: "",
              specialization: "",
              division: "Business Operations",
              instructions: "",
              model: defaultModel,
              outputSchemaKey: "general-report.v1",
              maxOutputTokens: 4096,
              budgetUsdPerRun: Math.min(0.25, env.AI_DAILY_BUDGET_USD),
              timeoutSeconds: 120,
              maxAttempts: 3,
            }}
            {...options}
            dailyLimitUsd={env.AI_DAILY_BUDGET_USD}
          />
        </CardContent>
      </Card>
    </div>
  );
}
