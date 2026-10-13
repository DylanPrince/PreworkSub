"use client";
import { FlaskConical, Play, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { formatUsd } from "@prince/shared";
import { ProviderBadge, StatusBadge } from "@/components/common/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import type { RunModes } from "@/components/tasks/run-controls";
import { dispatchWorkstreamsAction } from "@/lib/actions";
import { useHydrated } from "@/lib/use-hydrated";

export interface WorkstreamView {
  title: string;
  owner: string;
  description: string;
  dependsOn: string[];
  requiresHumanApproval: boolean;
  ready: boolean;
  unmetDependencies: string[];
  suggestedAgentId: string | null;
  estimates: Record<string, number | null>;
  task: {
    id: string;
    status: string;
    agentName: string;
    provider: string | null;
    costUsd: number | null;
  } | null;
}

/**
 * The owner's review step: choose which ready workstreams to dispatch and to which agent, see the
 * combined worst-case cost, and start them as paid Claude runs or free dry runs.
 */
export function DispatchPanel({
  commandId,
  workstreams,
  agents,
  modes,
  remainingUsd,
}: {
  commandId: string;
  workstreams: WorkstreamView[];
  agents: { id: string; name: string }[];
  modes: RunModes;
  remainingUsd: number;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(workstreams.map((w) => [w.title, w.ready && !!w.suggestedAgentId])),
  );
  const [choice, setChoice] = useState<Record<string, string>>(() =>
    Object.fromEntries(workstreams.map((w) => [w.title, w.suggestedAgentId ?? ""])),
  );

  const chosen = workstreams.filter((w) => w.ready && selected[w.title] && choice[w.title]);
  const total = useMemo(
    () => chosen.reduce((n, w) => n + (w.estimates[choice[w.title]!] ?? 0), 0),
    [chosen, choice],
  );
  const overBudget = total > remainingUsd;

  const dispatch = (provider: "anthropic" | "mock") =>
    start(async () => {
      const res = await dispatchWorkstreamsAction(commandId, {
        provider,
        items: chosen.map((w) => ({ workstream: w.title, agentId: choice[w.title]! })),
      });
      if (!res.ok) setError(res.error);
      else setError(null);
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <ol className="space-y-3">
        {workstreams.map((w, i) => {
          const id = `ws-${i}`;
          const estimate = choice[w.title] ? w.estimates[choice[w.title]!] : null;
          return (
            <li
              key={w.title}
              aria-labelledby={`${id}-title`}
              className="rounded-lg border border-border p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                  {w.ready ? (
                    <input
                      type="checkbox"
                      id={`${id}-check`}
                      aria-labelledby={`${id}-title`}
                      checked={!!selected[w.title]}
                      onChange={(e) => setSelected((s) => ({ ...s, [w.title]: e.target.checked }))}
                      className="mt-1 size-4 accent-[var(--primary)]"
                    />
                  ) : (
                    <span aria-hidden className="mt-1 size-4" />
                  )}
                  <div>
                    <p id={`${id}-title`} className="font-medium">
                      {w.title}
                    </p>
                    <p className="text-xs text-muted-foreground">Suggested role: {w.owner}</p>
                    <p className="mt-1 text-sm whitespace-pre-wrap">{w.description}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                      {w.dependsOn.length > 0 && (
                        <span className="text-muted-foreground">
                          After: {w.dependsOn.join(", ")}
                        </span>
                      )}
                      {w.requiresHumanApproval && (
                        <Badge tone="warning">
                          <ShieldAlert aria-hidden className="size-3" /> Owner approval flagged
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
                  {w.task ? (
                    <>
                      <span className="flex items-center gap-1.5">
                        <StatusBadge status={w.task.status} />
                        {w.task.provider && <ProviderBadge provider={w.task.provider} />}
                      </span>
                      <Link
                        href={`/tasks/${w.task.id}`}
                        className="text-xs text-primary hover:underline"
                      >
                        {w.task.agentName} task
                        {w.task.costUsd != null &&
                          ` · ${formatUsd(w.task.costUsd, { precise: true })}`}
                      </Link>
                    </>
                  ) : w.ready ? (
                    <>
                      <Select
                        aria-label={`Agent for ${w.title}`}
                        className="h-8 w-full text-xs sm:w-56"
                        value={choice[w.title]}
                        onChange={(e) => setChoice((c) => ({ ...c, [w.title]: e.target.value }))}
                      >
                        <option value="">Choose an agent</option>
                        {agents.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </Select>
                      <span className="text-xs text-muted-foreground">
                        {estimate == null
                          ? "No estimate"
                          : `Up to ${formatUsd(estimate, { precise: true })} with Claude`}
                      </span>
                    </>
                  ) : (
                    <Badge>Waiting on {w.unmetDependencies.join(", ")}</Badge>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2/40 p-4">
        <p className="text-sm" aria-live="polite">
          {chosen.length === 0
            ? "Select at least one ready workstream to dispatch."
            : `${chosen.length} selected. Worst case with Claude: ${formatUsd(total, { precise: true })} (remaining under your limits: ${formatUsd(remainingUsd)}).`}
        </p>
        {overBudget && modes.liveAvailable && (
          <p className="text-xs text-warning">
            This exceeds what remains under your spending limits, so a Claude dispatch will be
            refused. Select fewer workstreams or use a dry run.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Agents produce analysis and drafts only. Nothing is published, purchased, sent or paid.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!hydrated || pending || chosen.length === 0 || !modes.liveAvailable}
            title={modes.liveAvailable ? "Paid Claude API calls" : modes.liveBlockedReason}
            onClick={() => dispatch("anthropic")}
          >
            <Play /> Dispatch with Claude
          </Button>
          {modes.mockAvailable && (
            <Button
              variant="secondary"
              disabled={!hydrated || pending || chosen.length === 0}
              onClick={() => dispatch("mock")}
            >
              <FlaskConical /> Dispatch as dry run
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
      </div>
    </div>
  );
}
