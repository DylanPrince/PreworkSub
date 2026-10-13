"use client";
import { Archive, FlaskConical, Play, Plus, Power, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatUsd } from "@prince/shared";
import { Button } from "@/components/ui/button";
import { FieldError, Label, Select, Textarea } from "@/components/ui/input";
import type { RunModes } from "@/components/tasks/run-controls";
import {
  cancelWorkflowRunAction,
  createWorkflowFromTemplateAction,
  setWorkflowStatusAction,
  startWorkflowRunAction,
} from "@/lib/actions";
import { useHydrated } from "@/lib/use-hydrated";

function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-xs text-danger">
      {error}
    </p>
  );
}

/** Starts a run of a workflow with the owner's input, as paid Claude runs or a free dry run. */
export function WorkflowRunForm({
  workflowId,
  modes,
  worstCaseUsd,
  remainingUsd,
  disabledReason,
}: {
  workflowId: string;
  modes: RunModes;
  worstCaseUsd: number;
  remainingUsd: number;
  disabledReason?: string;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, start] = useTransition();
  const [input, setInput] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});
  const overBudget = worstCaseUsd > remainingUsd;

  const submit = (provider: "anthropic" | "mock") =>
    start(async () => {
      const res = await startWorkflowRunAction(workflowId, {
        input,
        provider,
        idempotencyKey: key,
      });
      setKey(crypto.randomUUID());
      if (!res.ok) {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
        return;
      }
      router.push(`/workflows/runs/${res.data.runId}`);
    });

  const blocked = !hydrated || pending || !!disabledReason;
  return (
    <form
      method="post"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit(modes.liveAvailable && modes.defaultProvider === "anthropic" ? "anthropic" : "mock");
      }}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wf-input">Input for this run</Label>
        <Textarea
          id="wf-input"
          value={input}
          maxLength={4000}
          className="min-h-20"
          onChange={(e) => setInput(e.target.value)}
          aria-invalid={!!fieldErrors.input}
          aria-describedby="wf-input-hint wf-input-error"
          placeholder="e.g. A refillable bamboo toothbrush subscription for eco-conscious families"
        />
        <p id="wf-input-hint" className="text-xs text-muted-foreground">
          With Claude, all steps together cost at most {formatUsd(worstCaseUsd, { precise: true })}{" "}
          (worst case for the longest input). {formatUsd(remainingUsd, { precise: true })} remains
          under your spending limits. Dry runs are free and produce labelled placeholder output.
        </p>
        <FieldError id="wf-input-error" message={fieldErrors.input?.[0]} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={blocked || !modes.liveAvailable || overBudget}
          title={
            !modes.liveAvailable
              ? modes.liveBlockedReason
              : overBudget
                ? "The worst case exceeds what remains under your spending limits"
                : "Paid Claude API calls"
          }
          onClick={() => submit("anthropic")}
        >
          <Play /> Run with Claude
        </Button>
        {modes.mockAvailable && (
          <Button
            type="button"
            variant="secondary"
            disabled={blocked}
            onClick={() => submit("mock")}
          >
            <FlaskConical /> Dry run (mock)
          </Button>
        )}
      </div>
      {disabledReason ? (
        <p className="text-xs text-muted-foreground">{disabledReason}</p>
      ) : (
        !modes.liveAvailable &&
        modes.liveBlockedReason && (
          <p className="text-xs text-muted-foreground">{modes.liveBlockedReason}</p>
        )
      )}
      <ErrorText error={error} />
    </form>
  );
}

export function WorkflowStatusControls({
  workflowId,
  status,
}: {
  workflowId: string;
  status: "active" | "disabled" | "archived";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const set = (next: "active" | "disabled" | "archived") =>
    start(async () => {
      const res = await setWorkflowStatusAction(workflowId, next);
      setError(res.ok ? null : res.error);
      if (res.ok && next === "archived") router.push("/workflows");
      router.refresh();
    });
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        {status === "active" ? (
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => set("disabled")}>
            <Power /> Disable
          </Button>
        ) : (
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => set("active")}>
            <Power /> {status === "archived" ? "Restore" : "Enable"}
          </Button>
        )}
        {status !== "archived" && (
          <Button
            size="sm"
            variant="danger"
            disabled={pending}
            onClick={() => {
              if (window.confirm("Archive this workflow? It stops running; its history is kept."))
                set("archived");
            }}
          >
            <Archive /> Archive
          </Button>
        )}
      </div>
      <ErrorText error={error} />
    </div>
  );
}

export function CancelWorkflowRunButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="danger"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await cancelWorkflowRunAction(runId);
            setError(res.ok ? null : res.error);
            router.refresh();
          })
        }
      >
        <Square /> Cancel run
      </Button>
      <ErrorText error={error} />
    </div>
  );
}

/** Copies a ready-made workflow into one of the user's businesses. */
export function UseTemplateForm({
  templateKey,
  templateName,
  businesses,
}: {
  templateKey: string;
  templateName: string;
  businesses: { id: string; name: string }[];
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, start] = useTransition();
  const [businessId, setBusinessId] = useState(businesses[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const id = `tpl-${templateKey}`;
  return (
    <form
      method="post"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await createWorkflowFromTemplateAction(businessId, templateKey);
          if (!res.ok) return setError(res.error);
          router.push(`/workflows/${res.data.workflowId}`);
        });
      }}
      className="flex flex-col gap-2"
    >
      <div className="flex flex-wrap items-end gap-2">
        {businesses.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-business`}>Business</Label>
            <Select
              id={`${id}-business`}
              value={businessId}
              onChange={(e) => setBusinessId(e.target.value)}
            >
              {businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          disabled={!hydrated || pending || !businessId}
          aria-label={`Use template: ${templateName}`}
        >
          <Plus /> Use template
        </Button>
      </div>
      <ErrorText error={error} />
    </form>
  );
}
