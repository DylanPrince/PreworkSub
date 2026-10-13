"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "./action-result";

/** Pending state, errors and field errors for a form that calls a server action. */
export function useFormAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});
  const submit = <T>(fn: () => Promise<ActionResult<T>>, onOk?: (data: T) => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
        return;
      }
      setError(null);
      setFieldErrors({});
      onOk?.(res.data);
      router.refresh();
    });
  return { pending, error, fieldErrors, submit, router };
}
