"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { testAnthropicAction } from "@/lib/actions";

export function TestAnthropicButton({ disabled }: { disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending || disabled}
        onClick={() =>
          start(async () => {
            const res = await testAnthropicAction();
            setMessage(res.ok ? res.data.message : res.error);
          })
        }
      >
        {pending ? "Testing…" : "Test connection"}
      </Button>
      {message && (
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {message}
        </p>
      )}
    </div>
  );
}
