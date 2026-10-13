"use client";
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Select, Textarea } from "@/components/ui/input";
import { createWorkflowAction, updateWorkflowAction } from "@/lib/actions";
import { useHydrated } from "@/lib/use-hydrated";

export interface EditorStep {
  /** Client-only key so React keeps focus while steps are renamed or reordered. */
  key: string;
  title: string;
  agentId: string;
  instructions: string;
  dependsOn: string[];
  requiresApproval: boolean;
}

export interface EditorAgent {
  id: string;
  name: string;
  division: string;
  businessId: string | null;
}

const MAX_STEPS = 12;

function blankStep(key: string, title: string): EditorStep {
  return {
    key,
    title,
    agentId: "",
    instructions: "",
    dependsOn: [],
    requiresApproval: false,
  };
}

/**
 * Creates or edits a workflow: an ordered list of steps, each assigned to an agent, with the steps
 * it waits for and whether it needs approval. The server re-validates everything, including that
 * the dependencies form no loop.
 */
export function WorkflowEditor({
  businesses,
  agents,
  initial,
}: {
  businesses: { id: string; name: string }[];
  agents: EditorAgent[];
  initial?: {
    workflowId: string;
    version: number;
    businessId: string;
    name: string;
    description: string;
    steps: Omit<EditorStep, "key">[];
  };
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, start] = useTransition();
  const [businessId, setBusinessId] = useState(initial?.businessId ?? businesses[0]?.id ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  // Keys are deterministic so server and client render the same field ids.
  const nextKey = useRef(0);
  const [steps, setSteps] = useState<EditorStep[]>(
    () => initial?.steps.map((s, i) => ({ ...s, key: `s${i}` })) ?? [blankStep("s0", "")],
  );
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});

  const available = agents.filter((a) => a.businessId === null || a.businessId === businessId);

  const update = (key: string, patch: Partial<EditorStep>) =>
    setSteps((all) => {
      const before = all.find((s) => s.key === key)!;
      return all.map((s) => {
        if (s.key === key) return { ...s, ...patch };
        // Keep dependencies pointing at a renamed step.
        if (patch.title !== undefined && s.dependsOn.includes(before.title))
          return {
            ...s,
            dependsOn: s.dependsOn.map((d) => (d === before.title ? patch.title! : d)),
          };
        return s;
      });
    });
  const remove = (key: string) =>
    setSteps((all) => {
      const gone = all.find((s) => s.key === key)!;
      return all
        .filter((s) => s.key !== key)
        .map((s) => ({ ...s, dependsOn: s.dependsOn.filter((d) => d !== gone.title) }));
    });
  const move = (index: number, by: -1 | 1) =>
    setSteps((all) => {
      const next = [...all];
      const [s] = next.splice(index, 1);
      next.splice(index + by, 0, s!);
      return next;
    });

  const submit = () =>
    start(async () => {
      const input = {
        businessId,
        name,
        description,
        steps: steps.map(({ key: _k, ...s }) => s),
      };
      const res = initial
        ? await updateWorkflowAction(initial.workflowId, initial.version, input)
        : await createWorkflowAction(input);
      if (!res.ok) {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
        return;
      }
      router.push(
        `/workflows/${initial ? initial.workflowId : (res.data as { workflowId: string }).workflowId}`,
      );
      router.refresh();
    });

  return (
    <form
      method="post"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-6"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {!initial && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wf-business">Business</Label>
            <Select
              id="wf-business"
              value={businessId}
              onChange={(e) => setBusinessId(e.target.value)}
              aria-invalid={!!fieldErrors.businessId}
            >
              {businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
            <FieldError message={fieldErrors.businessId?.[0]} />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wf-name">Name</Label>
          <Input
            id="wf-name"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={!!fieldErrors.name}
            aria-describedby="wf-name-error"
          />
          <FieldError id="wf-name-error" message={fieldErrors.name?.[0]} />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="wf-description">Description (optional)</Label>
          <Input
            id="wf-description"
            value={description}
            maxLength={500}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Steps</legend>
        <p className="text-xs text-muted-foreground">
          Write <code className="rounded bg-surface-2 px-1">{"{{input}}"}</code> where the
          run&apos;s input should go. A step starts once every step it waits for has succeeded, and
          receives their results.
        </p>
        <ol className="space-y-3">
          {steps.map((s, i) => {
            const id = `step-${s.key}`;
            const others = steps.filter((o) => o.key !== s.key && o.title.trim());
            return (
              <li key={s.key} className="space-y-3 rounded-lg border border-border p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">Step {i + 1}</h3>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`Move step ${i + 1} up`}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`Move step ${i + 1} down`}
                      disabled={i === steps.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove step ${i + 1}`}
                      disabled={steps.length === 1}
                      onClick={() => remove(s.key)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${id}-title`}>Step name</Label>
                    <Input
                      id={`${id}-title`}
                      value={s.title}
                      maxLength={80}
                      onChange={(e) => update(s.key, { title: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${id}-agent`}>Agent</Label>
                    <Select
                      id={`${id}-agent`}
                      value={s.agentId}
                      onChange={(e) => update(s.key, { agentId: e.target.value })}
                    >
                      <option value="">Choose an agent</option>
                      {available.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({a.division})
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <Label htmlFor={`${id}-instructions`}>Instructions</Label>
                    <Textarea
                      id={`${id}-instructions`}
                      value={s.instructions}
                      maxLength={5000}
                      className="min-h-20"
                      onChange={(e) => update(s.key, { instructions: e.target.value })}
                    />
                  </div>
                </div>
                {others.length > 0 && (
                  <fieldset>
                    <legend className="text-xs font-medium">Waits for</legend>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-2">
                      {others.map((o) => (
                        <label key={o.key} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="size-4 accent-[var(--primary)]"
                            checked={s.dependsOn.includes(o.title)}
                            onChange={(e) =>
                              update(s.key, {
                                dependsOn: e.target.checked
                                  ? [...s.dependsOn, o.title]
                                  : s.dependsOn.filter((d) => d !== o.title),
                              })
                            }
                          />
                          {o.title}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-[var(--primary)]"
                    checked={s.requiresApproval}
                    onChange={(e) => update(s.key, { requiresApproval: e.target.checked })}
                  />
                  <span>
                    Requires approval
                    <span className="block text-xs text-muted-foreground">
                      The step waits in the Approvals queue until an admin or owner approves it.
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ol>
        <FieldError message={fieldErrors.steps?.[0]} />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={steps.length >= MAX_STEPS}
          onClick={() =>
            setSteps((all) => [
              ...all,
              blankStep(`n${(nextKey.current += 1)}`, `Step ${all.length + 1}`),
            ])
          }
        >
          <Plus /> Add step
        </Button>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!hydrated || pending || !businessId}>
          <Save /> {initial ? "Save new version" : "Create workflow"}
        </Button>
        {initial && (
          <p className="text-xs text-muted-foreground">
            Runs already started keep the steps they started with.
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
