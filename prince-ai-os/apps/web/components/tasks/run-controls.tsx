"use client";
import { useQuery } from "@tanstack/react-query";
import { Play, RotateCcw, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cancelRunAction, retryRunAction, runTaskAction } from "@/lib/actions";

export function RunTaskButton({ taskId, disabled }: { taskId: string; disabled?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(() => crypto.randomUUID());
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        disabled={pending || disabled}
        onClick={() =>
          start(async () => {
            const res = await runTaskAction(taskId, key);
            if (!res.ok) setError(res.error);
            router.refresh();
          })
        }
      >
        <Play /> Run agent
      </Button>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function RunActions({ runId, status }: { runId: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const active = status === "queued" || status === "running";
  const retryable = status === "failed" || status === "cancelled";
  return (
    <div className="flex items-center gap-2">
      {active && (
        <Button
          size="sm"
          variant="danger"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await cancelRunAction(runId);
              if (!res.ok) setError(res.error);
              router.refresh();
            })
          }
        >
          <Square /> Cancel
        </Button>
      )}
      {retryable && (
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await retryRunAction(runId);
              if (!res.ok) setError(res.error);
              router.refresh();
            })
          }
        >
          <RotateCcw /> Retry
        </Button>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Polls the v1 run status endpoint while the rendered run is active. Whenever the server reports a
 * different status or event count than what is rendered, it refreshes server components; polling
 * continues until the rendered props catch up, so a refresh lost to a concurrent navigation is retried.
 */
export function RunPoller({
  runId,
  status,
  eventCount,
}: {
  runId: string;
  status: string;
  eventCount: number;
}) {
  const router = useRouter();
  const active = status === "queued" || status === "running";
  const { data, dataUpdatedAt } = useQuery({
    queryKey: ["run", runId],
    queryFn: async () => {
      const res = await fetch(`/api/v1/runs/${runId}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      return (await res.json()) as { status: string; updatedEvents: number };
    },
    enabled: active,
    refetchInterval: active ? 1500 : false,
  });
  useEffect(() => {
    if (data && (data.status !== status || data.updatedEvents !== eventCount)) router.refresh();
  }, [data, dataUpdatedAt, status, eventCount, router]);
  if (!active) return null;
  return (
    <p aria-live="polite" className="text-xs text-muted-foreground">
      Live: checking for updates…
    </p>
  );
}
