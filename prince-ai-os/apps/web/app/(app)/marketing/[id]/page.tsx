import { ArrowLeft, Flag, Send } from "lucide-react";
import Link from "next/link";
import { askableAgents, getCampaign, preferredAgentId, tasksAbout } from "@prince/core";
import { formatMoney } from "@prince/shared";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { ActionButton } from "@/components/modules/action-button";
import { AgentPanel } from "@/components/modules/agent-panel";
import { ApprovalHistory } from "@/components/modules/approval-history";
import { EditCampaignForm } from "@/components/modules/marketing-forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { endCampaignAction, requestCampaignApprovalAction } from "@/lib/module-actions";
import { orNotFound } from "@/lib/or-not-found";
import { getRunModes } from "@/lib/run-modes";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Campaign" };

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const {
    campaign: c,
    approvals,
    pendingApprovalId,
    canEdit,
  } = await orNotFound(getCampaign(db, user.id, id));
  const [agents, related, modes] = await Promise.all([
    askableAgents(db, c.businessId),
    tasksAbout(db, "campaign", c.id),
    getRunModes(),
  ]);
  const editable = canEdit && c.status !== "ended" && !c.archivedAt;
  const missing = [
    c.budgetUsd == null && "a budget",
    !c.startsOn && "a start date",
    c.channels.length === 0 && "a channel",
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <Link
        href="/marketing"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> Marketing
      </Link>
      <PageHeader
        title={c.name}
        description={`${c.business.name} · ${c.objective}`}
        actions={
          <>
            <StatusBadge status={c.status} />
            {editable && (
              <ActionButton
                variant="ghost"
                action={endCampaignAction.bind(null, c.id)}
                confirm={`Mark "${c.name}" as ended? Any pending approval is withdrawn and it can no longer be edited.`}
              >
                <Flag /> Mark ended
              </ActionButton>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card aria-labelledby="launch-heading">
            <CardHeader>
              <div>
                <CardTitle id="launch-heading">Launch approval</CardTitle>
                <CardDescription>
                  Approval covers this budget, these dates and these channels. Changing any of them
                  cancels it.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Planned budget</dt>
                  <dd className="font-mono tabular-nums">
                    {c.budgetUsd == null ? "Not set" : formatMoney(c.budgetUsd)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Dates</dt>
                  <dd className="font-mono text-xs">
                    {day(c.startsOn) ?? "Not set"} → {day(c.endsOn) ?? "open"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Channels</dt>
                  <dd>{c.channels.join(", ") || "None yet"}</dd>
                </div>
              </dl>

              {c.status === "planning" &&
                (pendingApprovalId ? (
                  <p className="text-sm">
                    Waiting for a decision.{" "}
                    <Link
                      href={`/approvals/${pendingApprovalId}`}
                      className="text-primary underline"
                    >
                      Open the approval request
                    </Link>
                    .
                  </p>
                ) : editable ? (
                  missing.length > 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Add {missing.join(", ")} before requesting approval.
                    </p>
                  ) : (
                    <ActionButton
                      variant="default"
                      action={requestCampaignApprovalAction.bind(null, c.id)}
                    >
                      <Send /> Request launch approval
                    </ActionButton>
                  )
                ) : null)}
              {c.status === "approved" && (
                <p className="text-sm">
                  Approved. Prince AI OS does not launch it or spend anything: launch it in the ad
                  platform within the approved budget and dates.
                </p>
              )}
              {c.status === "ended" && <p className="text-sm">This campaign has ended.</p>}

              <ApprovalHistory approvals={approvals} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Performance</CardTitle>
                <CardDescription>Not tracked yet</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Impressions, clicks, spend and return need an ad platform connection, which is not
                built yet. Record ad spend on the{" "}
                <Link href={`/finance?business=${c.businessId}`} className="underline">
                  Finance
                </Link>{" "}
                page in the meantime.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{editable ? "Edit campaign" : "Details"}</CardTitle>
            </CardHeader>
            <CardContent>
              {editable ? (
                <EditCampaignForm
                  id={c.id}
                  defaults={{
                    name: c.name,
                    objective: c.objective,
                    audience: c.audience,
                    channels: c.channels,
                    budgetUsd: c.budgetUsd,
                    startsOn: day(c.startsOn),
                    endsOn: day(c.endsOn),
                    notes: c.notes,
                  }}
                />
              ) : (
                <dl className="space-y-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Audience</dt>
                    <dd className="whitespace-pre-wrap">{c.audience || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Notes</dt>
                    <dd className="whitespace-pre-wrap">{c.notes || "—"}</dd>
                  </div>
                </dl>
              )}
            </CardContent>
          </Card>
        </div>

        <AgentPanel
          subjectType="campaign"
          subjectId={c.id}
          agents={agents}
          defaultAgentId={preferredAgentId(agents, "copywriting")}
          suggestions={[
            "Write three ad variations for this campaign, each with a headline and body.",
            "Review the audience and channels and suggest how to split the budget.",
          ]}
          modes={modes}
          tasks={related}
          canAsk={canEdit}
          description="The agent reads the campaign plan. Its suggestions are drafts; nothing is launched or spent."
        />
      </div>
    </div>
  );
}
