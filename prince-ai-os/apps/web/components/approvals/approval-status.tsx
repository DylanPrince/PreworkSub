import { Badge } from "@/components/ui/badge";

const LABELS = {
  pending: ["Waiting for decision", "warning"],
  approved: ["Approved", "info"],
  executed: ["Approved · carried out", "success"],
  failed: ["Approved · could not run", "danger"],
  rejected: ["Rejected", "danger"],
  expired: ["Expired", "neutral"],
  cancelled: ["Withdrawn", "neutral"],
} as const;

export function ApprovalStatusBadge({ status }: { status: string }) {
  const [label, tone] = LABELS[status as keyof typeof LABELS] ?? [status, "neutral"];
  return <Badge tone={tone}>{label}</Badge>;
}
