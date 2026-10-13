/** Renders validated agent JSON output generically: objects as labelled fields, arrays as lists. */
function humanize(key: string) {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

export function StructuredOutput({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined)
    return <span className="text-muted-foreground">—</span>;
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (typeof value !== "object")
    return <span className="whitespace-pre-wrap">{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">None</span>;
    const scalar = value.every((v) => typeof v !== "object");
    return scalar ? (
      <ul className="list-inside list-disc space-y-0.5">
        {value.map((v, i) => (
          <li key={i}>{String(v)}</li>
        ))}
      </ul>
    ) : (
      <ol className="space-y-2">
        {value.map((v, i) => (
          <li key={i} className="rounded-md border border-border bg-surface-2/50 p-3">
            <StructuredOutput value={v} depth={depth + 1} />
          </li>
        ))}
      </ol>
    );
  }
  return (
    <dl className={depth === 0 ? "space-y-4" : "space-y-1.5"}>
      {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
        <div key={k}>
          <dt
            className={
              depth === 0
                ? "text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                : "text-xs text-muted-foreground"
            }
          >
            {humanize(k)}
          </dt>
          <dd className="mt-0.5 text-sm">
            <StructuredOutput value={v} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
