import Link from "next/link";
import { notFound } from "next/navigation";
import { CATEGORY_LABELS, ForbiddenError, NotFoundError, getApproval } from "@prince/core";
import { formatUsd } from "@prince/shared";
import { ApprovalDecision } from "@/components/approvals/approval-decision";
import { ApprovalStatusBadge } from "@/components/approvals/approval-status";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";
import { relativeTime, timeUntil } from "@/lib/utils";

export const metadata = { title: "Approval request" };

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{value}</dd>
    </div>
  );
}

export default async function ApprovalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  let view;
  try {
    view = await getApproval(db, user.id, id);
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof ForbiddenError) notFound();
    throw e;
  }
  const { request: r, requestedByName, actionLabel, canDecide, canCancel } = view;
  const result = (r.result ?? null) as { taskId?: string } | null;
  const cost = r.estimatedCostUsd == null ? null : Number(r.estimatedCostUsd);

  return (
    <div className="space-y-6">
      <PageHeader
        title={r.title}
        description={`${r.business.name} · requested by ${requestedByName} ${relativeTime(r.createdAt)}`}
      />

      <Card aria-label="Request">
        <CardHeader className="flex-wrap">
          <CardTitle>What happens if approved</CardTitle>
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone="warning">{CATEGORY_LABELS[r.category]}</Badge>
            <ApprovalStatusBadge status={r.status} />
          </span>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm">{r.summary}</p>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Why approval is needed: </span>
            {r.reason}
          </p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <Field label="Action" value={actionLabel} />
            <Field
              label="Worst-case cost"
              value={
                cost == null
                  ? "Not estimated"
                  : cost === 0
                    ? "None (dry run)"
                    : formatUsd(cost, { precise: true })
              }
            />
            <Field
              label={r.status === "pending" ? "Expires" : "Expiry"}
              value={
                r.status === "pending"
                  ? timeUntil(r.expiresAt)
                  : r.expiresAt.toISOString().slice(0, 16).replace("T", " ") + " UTC"
              }
            />
            <Field
              label="Related"
              value={
                r.targetType === "command" && r.targetId ? (
                  <Link href={`/command/${r.targetId}`} className="text-primary hover:underline">
                    Command Center request
                  </Link>
                ) : (
                  "—"
                )
              }
            />
          </dl>
        </CardContent>
      </Card>

      <Card aria-label="Decision">
        <CardHeader>
          <CardTitle>Decision</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {r.status === "pending" ? (
            canDecide || canCancel ? (
              <ApprovalDecision approvalId={r.id} canDecide={canDecide} canCancel={canCancel} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Waiting for a business admin or owner to decide.
              </p>
            )
          ) : (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
              <Field label="Outcome" value={<ApprovalStatusBadge status={r.status} />} />
              <Field label="Decided by" value={r.decidedBy?.name ?? "—"} />
              <Field label="When" value={relativeTime(r.decidedAt ?? r.updatedAt)} />
              {r.decisionNote && (
                <div className="col-span-2 sm:col-span-3">
                  <Field label="Note" value={r.decisionNote} />
                </div>
              )}
            </dl>
          )}
          {r.status === "executed" && result?.taskId && (
            <p className="text-sm">
              Carried out:{" "}
              <Link href={`/tasks/${result.taskId}`} className="text-primary hover:underline">
                open the task
              </Link>
              .
            </p>
          )}
          {r.status === "failed" && r.errorMessage && (
            <p
              role="alert"
              className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger"
            >
              Could not be carried out: {r.errorMessage}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
