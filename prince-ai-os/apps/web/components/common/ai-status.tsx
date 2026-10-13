import { CircleAlert, CircleCheck, CircleSlash, FlaskConical, Zap } from "lucide-react";
import Link from "next/link";
import type { AiStatus, BudgetWindow } from "@prince/core";
import { formatUsd } from "@prince/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Plain-data view of AiStatus that can cross the server/client boundary. Never holds the key. */
export type AiStatusView = Pick<
  AiStatus,
  "mode" | "anthropicConfigured" | "realCallsAvailable" | "mockAvailable" | "budget"
>;

function headline(s: AiStatusView): {
  tone: "success" | "warning" | "danger";
  label: string;
  icon: typeof Zap;
} {
  if (s.anthropicConfigured && s.budget.blocked)
    return {
      tone: "danger",
      label: `${s.budget.day.reached ? "Daily" : "Monthly"} limit reached`,
      icon: CircleSlash,
    };
  if (s.mode === "live") return { tone: "success", label: "Claude live", icon: Zap };
  if (s.mode === "mock") return { tone: "warning", label: "Mock mode", icon: FlaskConical };
  return { tone: "warning", label: "Claude not configured", icon: CircleAlert };
}

/** Compact header indicator. Text carries the meaning; colour only reinforces it. */
export function AiStatusPill({ status }: { status: AiStatusView }) {
  const h = headline(status);
  const Icon = h.icon;
  const day = status.budget.day;
  return (
    <Link
      href="/integrations#ai-status"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium",
        h.tone === "success" && "border-success/30 bg-success-soft text-success",
        h.tone === "warning" && "border-warning/30 bg-warning-soft text-warning",
        h.tone === "danger" && "border-danger/30 bg-danger-soft text-danger",
      )}
      aria-label={`AI status: ${h.label}. Today ${formatUsd(day.committedUsd)} of ${formatUsd(day.limitUsd)} daily limit. Open details.`}
    >
      <Icon aria-hidden className="size-3.5" />
      <span>{h.label}</span>
      <span aria-hidden className="hidden text-current/80 sm:inline">
        · {formatUsd(day.committedUsd)} / {formatUsd(day.limitUsd)} today
      </span>
    </Link>
  );
}

function Row({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? (
        <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
      ) : (
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
      )}
      <div>
        <p className="text-sm font-medium">
          {label}: <span className={ok ? "text-success" : "text-warning"}>{ok ? "Yes" : "No"}</span>
        </p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
    </li>
  );
}

function Meter({ name, w }: { name: string; w: BudgetWindow }) {
  const pct = w.limitUsd > 0 ? Math.min(100, (w.committedUsd / w.limitUsd) * 100) : 100;
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium">{name}</span>
        <span className="text-muted-foreground">
          {formatUsd(w.actualUsd)} spent
          {w.reservedUsd > 0 && ` + ${formatUsd(w.reservedUsd)} reserved`} of{" "}
          {formatUsd(w.limitUsd)}
        </span>
      </div>
      <div
        role="meter"
        aria-label={`${name} AI spend`}
        aria-valuemin={0}
        aria-valuemax={w.limitUsd}
        aria-valuenow={Number(w.committedUsd.toFixed(4))}
        aria-valuetext={`${formatUsd(w.committedUsd)} of ${formatUsd(w.limitUsd)}${w.reached ? ", limit reached" : ""}`}
        className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className={cn(
            "h-full rounded-full",
            w.reached ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-success",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {w.reached && (
        <p className="mt-1 text-xs font-medium text-danger">
          Limit reached: new paid runs are refused.
        </p>
      )}
    </div>
  );
}

/** Detailed status used on Integrations and Settings. */
export function AiStatusPanel({ status }: { status: AiStatusView }) {
  const h = headline(status);
  return (
    <div id="ai-status" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={h.tone}>{h.label}</Badge>
        <span className="text-xs text-muted-foreground">
          Default for new runs:{" "}
          {status.mode === "mock" ? "mock provider (free, placeholder output)" : "Claude API"}
        </span>
      </div>
      <ul className="space-y-3">
        <Row
          ok={status.anthropicConfigured}
          label="Anthropic API key configured"
          detail={
            status.anthropicConfigured
              ? "A key is present in the server environment. It is never shown here or sent to the browser."
              : "Set ANTHROPIC_API_KEY in the server environment (see docs/api-key-setup.md), then restart the web app and worker."
          }
        />
        <Row
          ok={status.realCallsAvailable}
          label="Agents can make real Claude calls"
          detail={
            status.realCallsAvailable
              ? "Paid runs are allowed. Each one reserves its worst-case cost before calling the API."
              : status.anthropicConfigured
                ? "Blocked because a spending limit is reached."
                : "Blocked until an API key is configured."
          }
        />
        <Row
          ok={!status.budget.blocked}
          label="Within spending limits"
          detail="Limits are enforced by this app before each request. They are safeguards, not a billing cap on your Anthropic account."
        />
        <Row
          ok={status.mockAvailable}
          label="Dry runs (mock) available"
          detail={
            status.mockAvailable
              ? "Free runs with placeholder output, labelled Mock output everywhere they appear."
              : "Disabled because APP_ENV=production."
          }
        />
      </ul>
      <div className="space-y-3">
        <Meter name="Today (UTC)" w={status.budget.day} />
        <Meter name="This month (UTC)" w={status.budget.month} />
      </div>
    </div>
  );
}
