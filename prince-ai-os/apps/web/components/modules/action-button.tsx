"use client";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { useFormAction } from "@/lib/use-form-action";
import { useHydrated } from "@/lib/use-hydrated";

/**
 * A button that runs one server action (usually bound to a record id) and refreshes the page.
 * `confirm` asks first, for actions that are hard to take back.
 */
export function ActionButton({
  action,
  children,
  confirm,
  variant = "secondary",
  className,
  redirectTo,
  "aria-label": ariaLabel,
}: {
  action: () => Promise<ActionResult<unknown>>;
  children: ReactNode;
  confirm?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  className?: string;
  /** Page to open after success (for example the list, after archiving a record). */
  redirectTo?: string;
  "aria-label"?: string;
}) {
  const hydrated = useHydrated();
  const { pending, error, submit, router } = useFormAction();
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        type="button"
        size="sm"
        variant={variant}
        className={className}
        aria-label={ariaLabel}
        disabled={!hydrated || pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          submit(action, () => {
            if (redirectTo) router.push(redirectTo);
          });
        }}
      >
        {children}
      </Button>
      {error && (
        <span role="alert" className="max-w-xs text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
