"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/lib/use-hydrated";
import { FieldError, Input, Label, Textarea } from "@/components/ui/input";
import { createBusinessAction } from "@/lib/actions";

export function BusinessForm() {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const goals = String(f.get("goals") ?? "")
      .split("\n")
      .map((g) => g.trim())
      .filter(Boolean);
    start(async () => {
      const res = await createBusinessAction({
        name: String(f.get("name") ?? ""),
        businessModel: String(f.get("businessModel") ?? ""),
        description: String(f.get("description") ?? ""),
        goals,
      });
      if (!res.ok) {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
        return;
      }
      router.push(`/businesses/${res.data.id}`);
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4" method="post" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          required
          maxLength={80}
          aria-invalid={!!fieldErrors.name}
          aria-describedby="name-error"
        />
        <FieldError id="name-error" message={fieldErrors.name?.[0]} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="businessModel">Business model</Label>
        <Input
          id="businessModel"
          name="businessModel"
          maxLength={200}
          placeholder="e.g. DTC e-commerce, B2B SaaS, faceless YouTube channel"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" maxLength={2000} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="goals">Goals (one per line)</Label>
        <Textarea
          id="goals"
          name="goals"
          placeholder={"Validate 3 product ideas this month\nKeep AI spend under $50/month"}
        />
        <FieldError message={fieldErrors.goals?.[0]} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" disabled={!hydrated || pending}>
          {pending ? "Creating…" : "Create business"}
        </Button>
      </div>
    </form>
  );
}
