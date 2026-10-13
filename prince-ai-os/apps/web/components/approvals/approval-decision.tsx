"use client";
import { Check, Undo2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, Label, Textarea } from "@/components/ui/input";
import { cancelApprovalAction, decideApprovalAction } from "@/lib/actions";
import { useHydrated } from "@/lib/use-hydrated";

const OUTCOME: Record<string, string> = {
  executed: "Approved and carried out.",
  failed: "Approved, but it could not be carried out. See the reason below.",
  rejected: "Rejected. An identical request is now blocked.",
};

/** Approve / reject controls for admins and owners, and withdraw for the requester. */
export function ApprovalDecision({
  approvalId,
  canDecide,
  canCancel,
}: {
  approvalId: string;
  canDecide: boolean;
  canCancel: boolean;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [done, setDone] = useState<string | null>(null);

  const decide = (decision: "approve" | "reject") =>
    start(async () => {
      const res = await decideApprovalAction(approvalId, { decision, note });
      if (!res.ok) {
        setError(res.error);
        setFieldError(res.fieldErrors?.note?.[0]);
      } else {
        setError(null);
        setDone(OUTCOME[res.data.status] ?? `Saved: ${res.data.status}.`);
      }
      router.refresh();
    });
  const withdraw = () =>
    start(async () => {
      const res = await cancelApprovalAction(approvalId);
      if (!res.ok) setError(res.error);
      else setDone("Request withdrawn.");
      router.refresh();
    });

  return (
    <div className="space-y-3">
      {canDecide && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="decision-note">Note (optional)</Label>
          <Textarea
            id="decision-note"
            className="min-h-20"
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-invalid={!!fieldError}
            aria-describedby="decision-note-error"
            placeholder="Why you approve or reject it. Saved with the decision."
          />
          <FieldError id="decision-note-error" message={fieldError} />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {canDecide && (
          <>
            <Button disabled={!hydrated || pending} onClick={() => decide("approve")}>
              <Check /> Approve and run
            </Button>
            <Button
              variant="danger"
              disabled={!hydrated || pending}
              onClick={() => decide("reject")}
            >
              <X /> Reject
            </Button>
          </>
        )}
        {canCancel && (
          <Button variant="ghost" disabled={!hydrated || pending} onClick={withdraw}>
            <Undo2 /> Withdraw request
          </Button>
        )}
      </div>
      {!canDecide && canCancel && (
        <p className="text-xs text-muted-foreground">
          Only a business admin or owner can approve or reject this request.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="text-sm text-success">
          {done}
        </p>
      )}
    </div>
  );
}
