import { Archive, ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import {
  CONTENT_FORMATS,
  askableAgents,
  getContentItem,
  preferredAgentId,
  tasksAbout,
} from "@prince/core";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { ActionButton } from "@/components/modules/action-button";
import { AgentPanel } from "@/components/modules/agent-panel";
import { ApprovalHistory } from "@/components/modules/approval-history";
import {
  EditContentForm,
  MarkPublishedForm,
  RequestContentApprovalForm,
} from "@/components/modules/content-forms";
import { humanize, toOptions } from "@/components/modules/options";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { archiveContentAction, setContentStageAction } from "@/lib/module-actions";
import { orNotFound } from "@/lib/or-not-found";
import { getRunModes } from "@/lib/run-modes";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Content item" };

const MANUAL = ["idea", "drafting", "review"] as const;

export default async function ContentItemPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { item, approvals, pendingApprovalId, canEdit } = await orNotFound(
    getContentItem(db, user.id, id),
  );
  const [agents, related, modes] = await Promise.all([
    askableAgents(db, item.businessId),
    tasksAbout(db, "content_item", item.id),
    getRunModes(),
  ]);
  const editable = canEdit && !item.archivedAt && item.stage !== "published";

  return (
    <div className="space-y-6">
      <Link
        href="/content"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> Content Studio
      </Link>
      <PageHeader
        title={item.title}
        description={`${item.business.name} · ${humanize(item.format)}${item.channel ? ` · ${item.channel}` : ""}`}
        actions={
          <>
            <StatusBadge status={item.stage} />
            {item.archivedAt && <Badge>Archived</Badge>}
            {canEdit && !item.archivedAt && (
              <ActionButton
                variant="danger"
                action={archiveContentAction.bind(null, item.id)}
                confirm={`Archive "${item.title}"? Any pending approval is withdrawn; history is kept.`}
                redirectTo="/content"
              >
                <Archive /> Archive
              </ActionButton>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card aria-labelledby="publication-heading">
            <CardHeader>
              <div>
                <CardTitle id="publication-heading">Publication</CardTitle>
                <CardDescription>
                  Idea → drafting → review → approved by an admin or owner → published by a person.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {editable && item.stage !== "approved" && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">Move to</span>
                  {MANUAL.filter((s) => s !== item.stage).map((s) => (
                    <ActionButton key={s} action={setContentStageAction.bind(null, item.id, s)}>
                      {humanize(s)}
                    </ActionButton>
                  ))}
                </div>
              )}

              {item.stage === "review" &&
                (pendingApprovalId ? (
                  <p className="text-sm">
                    Waiting for a decision.{" "}
                    <Link
                      href={`/approvals/${pendingApprovalId}`}
                      className="text-primary underline"
                    >
                      Open the approval request
                    </Link>
                    . Editing the text withdraws it.
                  </p>
                ) : editable ? (
                  item.body.trim() ? (
                    <RequestContentApprovalForm id={item.id} />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Add the text to publish below before requesting approval.
                    </p>
                  )
                ) : null)}

              {item.stage === "approved" && (
                <div className="space-y-3">
                  <p className="text-sm">
                    Approved for publication
                    {item.scheduledFor ? ` on ${item.scheduledFor.toISOString().slice(0, 10)}` : ""}
                    . Prince AI OS does not post it: publish it where it belongs, then record it
                    here.
                  </p>
                  {editable && <MarkPublishedForm id={item.id} />}
                  {editable && (
                    <ActionButton
                      variant="ghost"
                      action={setContentStageAction.bind(null, item.id, "drafting")}
                      confirm="Move back to drafting? The approval no longer applies."
                    >
                      Back to drafting
                    </ActionButton>
                  )}
                </div>
              )}

              {item.stage === "published" && (
                <p className="text-sm">
                  Published {item.publishedAt ? item.publishedAt.toISOString().slice(0, 10) : ""}
                  {item.publishedUrl && (
                    <>
                      {" · "}
                      <a
                        href={item.publishedUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex items-center gap-1 text-primary underline"
                      >
                        View <ExternalLink className="size-3.5" aria-hidden />
                      </a>
                    </>
                  )}
                  . Published items are kept as a record and cannot be edited.
                </p>
              )}

              <ApprovalHistory approvals={approvals} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{editable ? "Edit" : "Text"}</CardTitle>
            </CardHeader>
            <CardContent>
              {editable ? (
                <EditContentForm
                  id={item.id}
                  formats={toOptions(CONTENT_FORMATS)}
                  defaults={{
                    title: item.title,
                    format: item.format,
                    channel: item.channel,
                    brief: item.brief,
                    body: item.body,
                  }}
                />
              ) : (
                <dl className="space-y-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Brief</dt>
                    <dd className="whitespace-pre-wrap">{item.brief || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Text</dt>
                    <dd className="whitespace-pre-wrap">{item.body || "—"}</dd>
                  </div>
                </dl>
              )}
            </CardContent>
          </Card>
        </div>

        <AgentPanel
          subjectType="content_item"
          subjectId={item.id}
          agents={agents}
          defaultAgentId={preferredAgentId(agents, "copywriting")}
          suggestions={[
            "Draft this piece from the brief, in a clear and friendly voice.",
            "Write three alternative headlines and an opening line for this piece.",
            "Tighten the current draft and point out any claims that need checking.",
          ]}
          modes={modes}
          tasks={related}
          canAsk={canEdit}
          description="The agent reads the brief and current text. Copy its draft into the text field yourself; nothing is published."
        />
      </div>
    </div>
  );
}
