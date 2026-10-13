import Link from "next/link";
import { formatUsd } from "@prince/shared";
import { ProviderBadge, StatusBadge } from "@/components/common/status-badge";
import { relativeTime } from "@/lib/utils";

export interface RelatedTask {
  id: string;
  title: string;
  agentName: string;
  status: string;
  createdAt: Date;
  provider: string | null;
  costUsd: number | null;
}

/** Agent tasks run about a record, newest first. */
export function RelatedTasks({ tasks }: { tasks: RelatedTask[] }) {
  if (tasks.length === 0)
    return <p className="text-sm text-muted-foreground">No agent work on this record yet.</p>;
  return (
    <ul className="divide-y divide-border">
      {tasks.map((t) => (
        <li
          key={t.id}
          className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <Link
              href={`/tasks/${t.id}`}
              className="line-clamp-1 text-sm font-medium hover:underline"
            >
              {t.title}
            </Link>
            <p className="text-xs text-muted-foreground">
              {t.agentName} · {relativeTime(t.createdAt)}
              {t.costUsd != null && ` · ${formatUsd(t.costUsd, { precise: true })}`}
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-1.5">
            <StatusBadge status={t.status} />
            {t.provider && <ProviderBadge provider={t.provider} />}
          </span>
        </li>
      ))}
    </ul>
  );
}
