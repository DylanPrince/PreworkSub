"use client";
import { Bot, FlaskConical } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/input";
import type { RunModes } from "@/components/tasks/run-controls";
import { askAgentAction } from "@/lib/module-actions";
import { useFormAction } from "@/lib/use-form-action";
import { useHydrated } from "@/lib/use-hydrated";
import { Field, FormError, describedBy } from "./field";

type SubjectType = "product" | "content_item" | "campaign" | "saas_project" | "finance";

/**
 * Starts an agent task about a record. The record's details are attached on the server, so the
 * agent always sees current data; the result appears under "Agent work" and in Tasks.
 */
export function AskAgent({
  subjectType,
  subjectId,
  agents,
  defaultAgentId,
  suggestions,
  modes,
}: {
  subjectType: SubjectType;
  subjectId: string;
  agents: { id: string; name: string }[];
  defaultAgentId?: string;
  suggestions: string[];
  modes: RunModes;
}) {
  const hydrated = useHydrated();
  const { pending, error, fieldErrors, submit, router } = useFormAction();
  const [agentId, setAgentId] = useState(defaultAgentId ?? agents[0]?.id ?? "");
  const [instructions, setInstructions] = useState(suggestions[0] ?? "");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const ask = (provider: "anthropic" | "mock") =>
    submit(
      () =>
        askAgentAction({
          subjectType,
          subjectId,
          agentId,
          instructions,
          provider,
          idempotencyKey: key,
        }),
      ({ taskId }) => {
        setKey(crypto.randomUUID());
        router.push(`/tasks/${taskId}`);
      },
    );
  const id = `ask-${subjectType}`;
  return (
    <form
      method="post"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        ask(modes.liveAvailable && modes.defaultProvider === "anthropic" ? "anthropic" : "mock");
      }}
      className="flex flex-col gap-3"
    >
      <Field id={`${id}-agent`} label="Agent" error={fieldErrors.agentId?.[0]}>
        <Select
          {...describedBy(`${id}-agent`, fieldErrors.agentId?.[0])}
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        id={`${id}-instructions`}
        label="What should the agent do?"
        error={fieldErrors.instructions?.[0]}
        hint="The record's current details are attached automatically."
      >
        <Textarea
          {...describedBy(`${id}-instructions`, fieldErrors.instructions?.[0], true)}
          value={instructions}
          maxLength={5000}
          className="min-h-20"
          onChange={(e) => setInstructions(e.target.value)}
        />
      </Field>
      {suggestions.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setInstructions(s)}
              className="rounded-md border border-border px-2 py-1 text-left text-xs text-muted-foreground hover:bg-surface-2 hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={!hydrated || pending || !agentId || !modes.liveAvailable}
          title={modes.liveAvailable ? "Paid Claude API call" : modes.liveBlockedReason}
          onClick={() => ask("anthropic")}
        >
          <Bot /> Ask with Claude
        </Button>
        {modes.mockAvailable && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!hydrated || pending || !agentId}
            onClick={() => ask("mock")}
          >
            <FlaskConical /> Dry run (mock)
          </Button>
        )}
      </div>
      {!modes.liveAvailable && modes.liveBlockedReason && (
        <p className="text-xs text-muted-foreground">{modes.liveBlockedReason}</p>
      )}
      <FormError error={error} />
    </form>
  );
}
