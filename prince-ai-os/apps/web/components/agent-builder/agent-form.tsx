"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatUsd } from "@prince/shared";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Select, Textarea } from "@/components/ui/input";
import { createAgentAction, updateAgentAction } from "@/lib/actions";
import { useHydrated } from "@/lib/use-hydrated";

export interface ModelOption {
  id: string;
  label: string;
  inputPerMTok: number;
  outputPerMTok: number;
}
export interface ContractOption {
  key: string;
  label: string;
  description: string;
}
export interface AgentFormValues {
  name: string;
  description: string;
  specialization: string;
  division: string;
  instructions: string;
  model: string;
  outputSchemaKey: string;
  maxOutputTokens: number;
  budgetUsdPerRun: number;
  timeoutSeconds: number;
  maxAttempts: number;
  /** "" means the model's default effort. */
  effort: "" | "low" | "medium" | "high";
}

type Mode =
  | { kind: "create"; businesses: { id: string; name: string }[]; defaultBusinessId?: string }
  | { kind: "edit"; agentId: string; currentVersion: number };

/** Mirrors the executor's pre-flight estimate (packages/core/src/executor.ts), for guidance only. */
function worstCaseUsd(values: AgentFormValues, model: ModelOption | undefined) {
  if (!model) return null;
  const inputTokens = Math.ceil(((values.instructions.length + 3000) / 4) * 1.25) + 500;
  return (
    (inputTokens * model.inputPerMTok + values.maxOutputTokens * model.outputPerMTok) / 1_000_000
  );
}

export function AgentForm({
  mode,
  initial,
  models,
  contracts,
  divisions,
  dailyLimitUsd,
}: {
  mode: Mode;
  initial: AgentFormValues;
  models: ModelOption[];
  contracts: ContractOption[];
  divisions: string[];
  dailyLimitUsd: number;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, start] = useTransition();
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});
  const [businessId, setBusinessId] = useState(
    mode.kind === "create" ? (mode.defaultBusinessId ?? mode.businesses[0]?.id ?? "") : "",
  );
  const [changeNote, setChangeNote] = useState("");

  const set = <K extends keyof AgentFormValues>(k: K, v: AgentFormValues[K]) =>
    setValues((prev) => ({ ...prev, [k]: v }));
  const model = models.find((m) => m.id === values.model);
  const contract = contracts.find((c) => c.key === values.outputSchemaKey);
  const estimate = worstCaseUsd(values, model);
  const overBudget = estimate !== null && estimate > values.budgetUsdPerRun;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaved(null);
    start(async () => {
      const res =
        mode.kind === "create"
          ? await createAgentAction({ ...values, businessId, changeNote })
          : await updateAgentAction(mode.agentId, mode.currentVersion, { ...values, changeNote });
      if (!res.ok) {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
        return;
      }
      setError(null);
      setFieldErrors({});
      if (mode.kind === "create" && "agentId" in res.data) {
        router.push(`/agent-builder/${res.data.agentId}`);
      } else {
        setChangeNote("");
        setSaved("Saved as a new version.");
        router.refresh();
      }
    });
  }

  const field = (
    id: keyof AgentFormValues | "businessId" | "changeNote",
    label: string,
    control: React.ReactNode,
    hint?: React.ReactNode,
  ) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {control}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      <FieldError id={`${id}-error`} message={fieldErrors[id]?.[0]} />
    </div>
  );
  const aria = (id: string, hint = false) => ({
    id,
    name: id,
    "aria-invalid": !!fieldErrors[id],
    "aria-describedby": [hint && `${id}-hint`, `${id}-error`].filter(Boolean).join(" "),
  });

  return (
    <form onSubmit={onSubmit} method="post" noValidate className="flex flex-col gap-6">
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Identity</legend>
        {mode.kind === "create" &&
          field(
            "businessId",
            "Business",
            <Select
              {...aria("businessId", true)}
              value={businessId}
              onChange={(e) => setBusinessId(e.target.value)}
            >
              {mode.businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>,
            "Custom agents belong to one business and only see that business's data.",
          )}
        {field(
          "name",
          "Name",
          <Input
            {...aria("name")}
            maxLength={80}
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
          />,
        )}
        {field(
          "division",
          "Division",
          <Select
            {...aria("division")}
            value={values.division}
            onChange={(e) => set("division", e.target.value)}
          >
            {divisions.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </Select>,
        )}
        {field(
          "specialization",
          "Specialization",
          <Input
            {...aria("specialization")}
            maxLength={120}
            value={values.specialization}
            onChange={(e) => set("specialization", e.target.value)}
          />,
        )}
        <div className="sm:col-span-2">
          {field(
            "description",
            "Description",
            <Textarea
              {...aria("description")}
              className="min-h-20"
              maxLength={500}
              value={values.description}
              onChange={(e) => set("description", e.target.value)}
            />,
          )}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-sm font-semibold">Behaviour</legend>
        {field(
          "instructions",
          "Instructions (system prompt)",
          <Textarea
            {...aria("instructions", true)}
            className="min-h-56 font-mono text-xs"
            maxLength={20000}
            value={values.instructions}
            onChange={(e) => set("instructions", e.target.value)}
            placeholder={
              "You are the … agent for this business.\n- Goal: what you produce and for whom\n- Method: how to reason, what to check, what to avoid\n- Quality bar: what a good answer contains; say when information is missing"
            }
          />,
          "Describe the role, method and quality bar. Shared guardrails (no invented data, no external actions, approval rules) are always added in front of these instructions.",
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {field(
            "outputSchemaKey",
            "Output format",
            <Select
              {...aria("outputSchemaKey", true)}
              value={values.outputSchemaKey}
              onChange={(e) => set("outputSchemaKey", e.target.value)}
            >
              {contracts.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label} ({c.key})
                </option>
              ))}
            </Select>,
            contract?.description,
          )}
          {field(
            "model",
            "Model",
            <Select
              {...aria("model", true)}
              value={values.model}
              onChange={(e) => set("model", e.target.value)}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </Select>,
            model &&
              `$${model.inputPerMTok} input / $${model.outputPerMTok} output per million tokens`,
          )}
          {field(
            "effort",
            "Effort",
            <Select
              {...aria("effort", true)}
              value={values.effort}
              onChange={(e) => set("effort", e.target.value as AgentFormValues["effort"])}
            >
              <option value="">Model default</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>,
            "How much the model reasons before answering. Thinking is billed as output and counts toward max output tokens, so higher effort needs a larger limit.",
          )}
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="mb-2 text-sm font-semibold">Limits</legend>
        {field(
          "maxOutputTokens",
          "Max output tokens",
          <Input
            {...aria("maxOutputTokens", true)}
            type="number"
            inputMode="numeric"
            min={256}
            max={32000}
            step={256}
            value={values.maxOutputTokens}
            onChange={(e) => set("maxOutputTokens", Number(e.target.value))}
          />,
          "Includes thinking. A run that reaches it fails instead of returning a cut-off answer.",
        )}
        {field(
          "budgetUsdPerRun",
          "Budget per run (USD)",
          <Input
            {...aria("budgetUsdPerRun", true)}
            type="number"
            inputMode="decimal"
            min={0.01}
            max={Math.min(10, dailyLimitUsd)}
            step={0.01}
            value={values.budgetUsdPerRun}
            onChange={(e) => set("budgetUsdPerRun", Number(e.target.value))}
          />,
          `Cannot exceed the daily limit of ${formatUsd(dailyLimitUsd)}.`,
        )}
        {field(
          "timeoutSeconds",
          "Timeout (seconds)",
          <Input
            {...aria("timeoutSeconds")}
            type="number"
            inputMode="numeric"
            min={10}
            max={600}
            value={values.timeoutSeconds}
            onChange={(e) => set("timeoutSeconds", Number(e.target.value))}
          />,
        )}
        {field(
          "maxAttempts",
          "Max attempts",
          <Input
            {...aria("maxAttempts")}
            type="number"
            inputMode="numeric"
            min={1}
            max={5}
            value={values.maxAttempts}
            onChange={(e) => set("maxAttempts", Number(e.target.value))}
          />,
        )}
        <p
          className={`text-xs sm:col-span-2 lg:col-span-4 ${overBudget ? "text-warning" : "text-muted-foreground"}`}
          aria-live="polite"
        >
          {estimate === null
            ? "Choose a model to see a cost estimate."
            : `Estimated worst case per attempt: about ${formatUsd(estimate)} (rough guide; the worker computes the exact pre-flight figure with the real prompt). ${overBudget ? "This exceeds the per-run budget, so runs will be refused until you raise the budget or lower max output tokens." : ""}`}
        </p>
      </fieldset>

      <fieldset className="rounded-md border border-border p-4">
        <legend className="px-1 text-sm font-semibold">Capabilities</legend>
        <ul className="space-y-1 text-sm">
          <li>Reads the business profile and the task instructions: yes</li>
          <li>
            External actions (spending, publishing, purchasing, contacting customers): none. No
            agent has tools that act outside Prince AI OS yet; when they arrive, each action will
            need your explicit approval.
          </li>
        </ul>
      </fieldset>

      {field(
        "changeNote",
        "Change note (optional)",
        <Input
          {...aria("changeNote")}
          maxLength={300}
          value={changeNote}
          onChange={(e) => setChangeNote(e.target.value)}
          placeholder={mode.kind === "create" ? "Created in Agent Builder" : "What changed and why"}
        />,
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-success">
          {saved}
        </p>
      )}
      <div>
        <Button
          type="submit"
          disabled={!hydrated || pending || (mode.kind === "create" && !businessId)}
        >
          {pending
            ? "Saving…"
            : mode.kind === "create"
              ? "Create agent"
              : `Save as v${mode.currentVersion + 1}`}
        </Button>
      </div>
    </form>
  );
}
