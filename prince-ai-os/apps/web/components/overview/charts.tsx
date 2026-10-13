"use client";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Point = {
  date: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  succeeded: number;
  failed: number;
};

const axis = {
  stroke: "var(--muted-foreground)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;
const tooltipStyle = {
  contentStyle: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    fontSize: 12,
    color: "var(--foreground)",
  },
  labelStyle: { color: "var(--muted-foreground)" },
};
const short = (d: string) => d.slice(5);

function ChartFrame({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <div role="img" aria-label={label} className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

export function CostChart({ data }: { data: Point[] }) {
  return (
    <ChartFrame label="Daily AI cost in US dollars">
      <AreaChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="cost" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="date" tickFormatter={short} {...axis} />
        <YAxis width={56} tickFormatter={(v: number) => `$${v.toFixed(v < 1 ? 3 : 2)}`} {...axis} />
        <Tooltip {...tooltipStyle} formatter={(v) => [`$${Number(v).toFixed(6)}`, "Cost"]} />
        <Area
          type="monotone"
          dataKey="costUsd"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="url(#cost)"
        />
      </AreaChart>
    </ChartFrame>
  );
}

export function TokenChart({ data }: { data: Point[] }) {
  return (
    <ChartFrame label="Daily input and output tokens">
      <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="date" tickFormatter={short} {...axis} />
        <YAxis width={56} {...axis} />
        <Tooltip {...tooltipStyle} cursor={{ fill: "var(--surface-2)" }} />
        <Bar
          dataKey="inputTokens"
          name="Input"
          stackId="t"
          fill="var(--chart-2)"
          radius={[0, 0, 0, 0]}
        />
        <Bar
          dataKey="outputTokens"
          name="Output"
          stackId="t"
          fill="var(--chart-1)"
          radius={[3, 3, 0, 0]}
        />
      </BarChart>
    </ChartFrame>
  );
}

export function OutcomeChart({ data }: { data: Point[] }) {
  return (
    <ChartFrame label="Daily succeeded and failed agent runs">
      <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="date" tickFormatter={short} {...axis} />
        <YAxis width={32} allowDecimals={false} {...axis} />
        <Tooltip {...tooltipStyle} cursor={{ fill: "var(--surface-2)" }} />
        <Bar dataKey="succeeded" name="Succeeded" stackId="o" fill="var(--chart-3)" />
        <Bar
          dataKey="failed"
          name="Failed"
          stackId="o"
          fill="var(--danger)"
          radius={[3, 3, 0, 0]}
        />
      </BarChart>
    </ChartFrame>
  );
}

export function CostByAgentChart({ data }: { data: { agent: string; costUsd: number }[] }) {
  return (
    <ChartFrame label="AI cost by agent">
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 8, bottom: 0 }}>
        <CartesianGrid stroke="var(--border)" horizontal={false} />
        <XAxis type="number" tickFormatter={(v: number) => `$${v.toFixed(3)}`} {...axis} />
        <YAxis type="category" dataKey="agent" width={140} {...axis} />
        <Tooltip
          {...tooltipStyle}
          cursor={{ fill: "var(--surface-2)" }}
          formatter={(v) => [`$${Number(v).toFixed(6)}`, "Cost"]}
        />
        <Bar dataKey="costUsd" fill="var(--chart-1)" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ChartFrame>
  );
}

/** Monthly net revenue against costs (cost of goods plus operating expenses). */
export function MonthlyPnlChart({
  data,
}: {
  data: { month: string; netRevenue: number; expenses: number }[];
}) {
  return (
    <div>
      <ChartFrame label="Net revenue and costs by month">
        <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="month" {...axis} />
          <YAxis width={56} tickFormatter={(v: number) => `$${v}`} {...axis} />
          <Tooltip
            {...tooltipStyle}
            cursor={{ fill: "var(--surface-2)" }}
            formatter={(v, name) => [
              `$${Number(v).toFixed(2)}`,
              name === "netRevenue" ? "Net revenue" : "Costs",
            ]}
          />
          <Bar dataKey="netRevenue" fill="var(--chart-3)" radius={[3, 3, 0, 0]} />
          <Bar dataKey="expenses" fill="var(--chart-4)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ChartFrame>
      <p aria-hidden className="mt-2 flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-[var(--chart-3)]" /> Net revenue
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-[var(--chart-4)]" /> Costs
        </span>
      </p>
    </div>
  );
}
