import Link from "next/link";
import { ApprovalStatusBadge } from "@/components/approvals/approval-status";
import { relativeTime } from "@/lib/utils";

/** Recent approval requests for a record, newest first. */
export function ApprovalHistory({
  approvals,
}: {
  approvals: {
    id: string;
    title: string;
    status: string;
    createdAt: Date;
    decisionNote?: string | null;
  }[];
}) {
  if (approvals.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1 text-xs font-medium text-muted-foreground">Approval history</h3>
      <ul className="divide-y divide-border">
        {approvals.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <Link href={`/approvals/${a.id}`} className="hover:underline">
              Requested {relativeTime(a.createdAt)}
            </Link>
            <ApprovalStatusBadge status={a.status} />
            {a.decisionNote && (
              <p className="w-full text-xs text-muted-foreground">Note: {a.decisionNote}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
