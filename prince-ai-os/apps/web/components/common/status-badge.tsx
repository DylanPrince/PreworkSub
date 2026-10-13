import { Badge } from "@/components/ui/badge";

const TONES = {
  open: "neutral",
  queued: "info",
  running: "primary",
  succeeded: "success",
  failed: "danger",
  cancelled: "warning",
  active: "success",
  disabled: "neutral",
} as const;

export function StatusBadge({ status }: { status: string }) {
  const tone = TONES[status as keyof typeof TONES] ?? "neutral";
  return (
    <Badge tone={tone}>
      {status === "running" && (
        <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" />
      )}
      {status}
    </Badge>
  );
}

export function ProviderBadge({ provider }: { provider: string }) {
  return provider === "mock" ? (
    <Badge tone="warning" title="Generated locally without an AI model. Not real analysis.">
      Mock output
    </Badge>
  ) : (
    <Badge tone="neutral">{provider}</Badge>
  );
}
