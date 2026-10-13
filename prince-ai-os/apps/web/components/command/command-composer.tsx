"use client";
import { FlaskConical, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, Label, Select, Textarea } from "@/components/ui/input";
import type { RunModes } from "@/components/tasks/run-controls";
import { createCommandAction } from "@/lib/actions";
import { useHydrated } from "@/lib/use-hydrated";

export function CommandComposer({
  businesses,
  modes,
}: {
  businesses: { id: string; name: string }[];
  modes: RunModes;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, start] = useTransition();
  const [businessId, setBusinessId] = useState(businesses[0]?.id ?? "");
  const [request, setRequest] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});
  const [key, setKey] = useState(() => crypto.randomUUID());

  const submit = (provider: "anthropic" | "mock") =>
    start(async () => {
      const res = await createCommandAction({ businessId, request, provider, idempotencyKey: key });
      setKey(crypto.randomUUID());
      if (!res.ok) {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
        return;
      }
      router.push(`/command/${res.data.commandId}`);
    });

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
      {businesses.length > 1 && (
        <div className="flex flex-col gap-1.5 sm:max-w-xs">
          <Label htmlFor="command-business">Business</Label>
          <Select
            id="command-business"
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
        <Label htmlFor="command-request">What do you want to achieve?</Label>
        <Textarea
          id="command-request"
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          maxLength={10000}
          className="min-h-28"
          aria-invalid={!!fieldErrors.request}
          aria-describedby="command-request-hint command-request-error"
          placeholder="e.g. Find two product ideas we could launch this quarter and estimate their margins."
        />
        <p id="command-request-hint" className="text-xs text-muted-foreground">
          The Executive Coordinator drafts a plan first. You review it, with estimated costs, before
          any specialist agent starts.
        </p>
        <FieldError id="command-request-error" message={fieldErrors.request?.[0]} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={!hydrated || pending || !businessId || !modes.liveAvailable}
          title={modes.liveAvailable ? "Paid Claude API call" : modes.liveBlockedReason}
          onClick={() => submit("anthropic")}
        >
          <Send /> Plan with Claude
        </Button>
        {modes.mockAvailable && (
          <Button
            type="button"
            variant="secondary"
            disabled={!hydrated || pending || !businessId}
            onClick={() => submit("mock")}
          >
            <FlaskConical /> Dry run (mock)
          </Button>
        )}
      </div>
      {!modes.liveAvailable && modes.liveBlockedReason && (
        <p className="text-xs text-muted-foreground">{modes.liveBlockedReason}</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
