"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/lib/use-hydrated";
import { FieldError, Input, Label, Select, Textarea } from "@/components/ui/input";
import { createTaskAction } from "@/lib/actions";

interface Option {
  id: string;
  name: string;
}
interface AgentOption extends Option {
  businessId: string | null;
  executable: boolean;
}

export function TaskForm({
  businesses,
  agents,
  defaultBusinessId,
  defaultAgentId,
}: {
  businesses: Option[];
  agents: AgentOption[];
  defaultBusinessId?: string;
  defaultAgentId?: string;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, start] = useTransition();
  const [businessId, setBusinessId] = useState(defaultBusinessId ?? businesses[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});
  // Generated once per form render so a double submit cannot start two runs.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const available = useMemo(
    () => agents.filter((a) => a.businessId === null || a.businessId === businessId),
    [agents, businessId],
  );

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    start(async () => {
      const res = await createTaskAction({
        businessId,
        agentId: String(f.get("agentId") ?? ""),
        title: String(f.get("title") ?? ""),
        instructions: String(f.get("instructions") ?? ""),
        runNow: f.get("runNow") === "on",
        idempotencyKey,
      });
      if (!res.ok) {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
        return;
      }
      router.push(`/tasks/${res.data.taskId}`);
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-4" method="post" noValidate>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="businessId">Business</Label>
          <Select
            id="businessId"
            name="businessId"
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
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="agentId">Agent</Label>
          <Select
            id="agentId"
            name="agentId"
            defaultValue={defaultAgentId}
            aria-invalid={!!fieldErrors.agentId}
          >
            {available.map((a) => (
              <option key={a.id} value={a.id} disabled={!a.executable}>
                {a.name}
                {a.executable ? "" : " (not executable)"}
              </option>
            ))}
          </Select>
          <FieldError message={fieldErrors.agentId?.[0]} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          name="title"
          maxLength={200}
          aria-invalid={!!fieldErrors.title}
          aria-describedby="title-error"
        />
        <FieldError id="title-error" message={fieldErrors.title?.[0]} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="instructions">Instructions</Label>
        <Textarea
          id="instructions"
          name="instructions"
          className="min-h-40"
          maxLength={20000}
          aria-invalid={!!fieldErrors.instructions}
          aria-describedby="instructions-error"
          placeholder="What should the agent produce? Include any figures or context it should use."
        />
        <FieldError id="instructions-error" message={fieldErrors.instructions?.[0]} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="runNow"
          defaultChecked
          className="size-4 accent-[var(--primary)]"
        />
        Run the agent immediately
      </label>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" disabled={!hydrated || pending || !businessId}>
          {pending ? "Creating…" : "Create task"}
        </Button>
      </div>
    </form>
  );
}
