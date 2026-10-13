"use client";
import { Archive, Copy, FlaskConical, Play, Power, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, Label, Select, Textarea } from "@/components/ui/input";
import type { RunModes } from "@/components/tasks/run-controls";
import {
  duplicateAgentAction,
  restoreAgentVersionAction,
  setAgentStatusAction,
  testAgentAction,
} from "@/lib/actions";
import { useHydrated } from "@/lib/use-hydrated";

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const exec = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong");
      else {
        setError(null);
        after?.();
      }
      router.refresh();
    });
  return { pending, error, exec, router };
}

export function AgentStatusControls({
  agentId,
  status,
}: {
  agentId: string;
  status: "active" | "disabled" | "archived";
}) {
  const { pending, error, exec } = useAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        {status !== "active" && (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => exec(() => setAgentStatusAction(agentId, "active"))}
          >
            <Power /> {status === "archived" ? "Restore" : "Enable"}
          </Button>
        )}
        {status === "active" && (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => exec(() => setAgentStatusAction(agentId, "disabled"))}
          >
            <Power /> Disable
          </Button>
        )}
        {status !== "archived" && (
          <Button
            size="sm"
            variant="danger"
            disabled={pending}
            onClick={() => {
              if (window.confirm("Archive this agent? It stops accepting tasks; history is kept."))
                exec(() => setAgentStatusAction(agentId, "archived"));
            }}
          >
            <Archive /> Archive
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function RestoreVersionButton({ agentId, version }: { agentId: string; version: number }) {
  const { pending, error, exec } = useAction();
  return (
    <span className="inline-flex flex-col items-start">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        aria-label={`Restore configuration from version ${version}`}
        onClick={() => exec(() => restoreAgentVersionAction(agentId, version))}
      >
        <RotateCcw /> Restore
      </Button>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}

export function DuplicateAgentButton({
  agentId,
  businesses,
}: {
  agentId: string;
  businesses: { id: string; name: string }[];
}) {
  const { pending, error, exec, router } = useAction();
  const [businessId, setBusinessId] = useState(businesses[0]?.id ?? "");
  if (businesses.length === 0) return null;
  return (
    <div className="flex flex-col items-stretch gap-1 sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        {businesses.length > 1 && (
          <Select
            aria-label="Business to copy the agent into"
            className="h-8 w-full text-xs sm:w-44"
            value={businessId}
            onChange={(e) => setBusinessId(e.target.value)}
          >
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
        <Button
          size="sm"
          variant="secondary"
          disabled={pending || !businessId}
          onClick={() =>
            exec(async () => {
              const res = await duplicateAgentAction(agentId, businessId);
              if (res.ok) router.push(`/agent-builder/${res.data.agentId}`);
              return res;
            })
          }
        >
          <Copy /> Duplicate to customise
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Runs the current version on sample instructions, as a paid Claude run or a free dry run. */
export function TestAgentPanel({
  agentId,
  businesses,
  modes,
  disabled,
}: {
  agentId: string;
  businesses: { id: string; name: string }[];
  modes: RunModes;
  disabled?: boolean;
}) {
  const hydrated = useHydrated();
  const { pending, error, exec, router } = useAction();
  const [businessId, setBusinessId] = useState(businesses[0]?.id ?? "");
  const [instructions, setInstructions] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});
  const [key, setKey] = useState(() => crypto.randomUUID());

  const runWith = (provider: "anthropic" | "mock") =>
    exec(async () => {
      const res = await testAgentAction(agentId, {
        businessId,
        instructions,
        provider,
        idempotencyKey: key,
      });
      setKey(crypto.randomUUID());
      if (!res.ok) {
        setFieldErrors(res.fieldErrors ?? {});
        return res;
      }
      setFieldErrors({});
      router.push(`/tasks/${res.data.taskId}`);
      return res;
    });

  return (
    <div className="flex flex-col gap-3">
      {businesses.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="test-business">Business context</Label>
          <Select
            id="test-business"
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
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="test-instructions">Sample task</Label>
        <Textarea
          id="test-instructions"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          maxLength={20000}
          aria-invalid={!!fieldErrors.instructions}
          aria-describedby="test-instructions-error"
          placeholder="Describe a realistic task for this agent."
        />
        <FieldError id="test-instructions-error" message={fieldErrors.instructions?.[0]} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!hydrated || pending || disabled || !modes.liveAvailable}
          title={modes.liveAvailable ? "Paid Claude API call" : modes.liveBlockedReason}
          onClick={() => runWith("anthropic")}
        >
          <Play /> Test with Claude
        </Button>
        {modes.mockAvailable && (
          <Button
            variant="secondary"
            disabled={!hydrated || pending || disabled}
            onClick={() => runWith("mock")}
          >
            <FlaskConical /> Dry run (mock)
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {modes.liveAvailable
          ? "Claude tests are paid and count toward your spending limits. Dry runs are free and return labelled placeholder output."
          : modes.liveBlockedReason}
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
