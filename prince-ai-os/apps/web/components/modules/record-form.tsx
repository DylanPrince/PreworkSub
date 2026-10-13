"use client";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { useFormAction } from "@/lib/use-form-action";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";
import { FormError, formValues, type FieldErrors } from "./field";

/**
 * Form shell for module records: collects the fields, calls the server action, shows field and
 * form errors, and on success resets (create), confirms (edit) or opens the new record.
 */
export function RecordForm<T>({
  label,
  action,
  submitLabel,
  after = "confirm",
  redirect,
  className,
  children,
}: {
  /** Accessible name of the form. */
  label: string;
  action: (values: Record<string, string>) => Promise<ActionResult<T>>;
  submitLabel: string;
  after?: "reset" | "confirm";
  /** Opens a page after success, built from a field of the action's result. */
  redirect?: { prefix: string; key: keyof T & string };
  className?: string;
  children: (errors: FieldErrors) => ReactNode;
}) {
  const hydrated = useHydrated();
  const { pending, error, fieldErrors, submit, router } = useFormAction();
  const [saved, setSaved] = useState(false);
  return (
    <form
      method="post"
      noValidate
      aria-label={label}
      className={cn("flex flex-col gap-4", className)}
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const values = formValues(form);
        setSaved(false);
        submit(
          () => action(values),
          (data) => {
            if (redirect) router.push(`${redirect.prefix}${String(data[redirect.key])}`);
            else if (after === "reset") form.reset();
            setSaved(true);
          },
        );
      }}
    >
      {children(fieldErrors)}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={!hydrated || pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        <p role="status" className="text-xs text-muted-foreground">
          {saved && !pending && !error ? "Saved." : ""}
        </p>
      </div>
      <FormError error={error} />
    </form>
  );
}
