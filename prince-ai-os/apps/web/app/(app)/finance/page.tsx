import { AlertTriangle, Ban } from "lucide-react";
import { Suspense } from "react";
import {
  FINANCE_KINDS,
  FINANCE_KIND_LABELS,
  askableAgents,
  getFinance,
  listBusinesses,
  preferredAgentId,
  tasksAbout,
  writableBusinesses,
} from "@prince/core";
import { formatMoney, formatUsd } from "@prince/shared";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Stat } from "@/components/common/stat";
import { ActionButton } from "@/components/modules/action-button";
import { AgentPanel } from "@/components/modules/agent-panel";
import { FinanceEntryForm } from "@/components/modules/finance-forms";
import { toOptions } from "@/components/modules/options";
import { OverviewFilters } from "@/components/overview/filters";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { voidFinanceEntryAction } from "@/lib/module-actions";
import { getRunModes } from "@/lib/run-modes";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata = { title: "Finance" };

const RANGES = [7, 30, 90, 365];
const EXPENSE_KINDS = new Set([
  "refund",
  "cogs",
  "operating_expense",
  "ad_spend",
  "subscription",
  "other_expense",
]);

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ business?: string; days?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const days = RANGES.includes(Number(sp.days)) ? Number(sp.days) : 30;
  const [businesses, writable, modes] = await Promise.all([
    listBusinesses(db, user.id),
    writableBusinesses(db, user.id),
    getRunModes(),
  ]);
  // Only a business the viewer belongs to can scope the page.
  const scoped = businesses.find((b) => b.id === sp.business);
  const { summary: s, entries } = await getFinance(db, user.id, { businessId: scoped?.id, days });

  // The Financial Analyst works on one business at a time.
  const askFor = scoped ?? (businesses.length === 1 ? businesses[0] : undefined);
  const canAsk = !!askFor && writable.some((b) => b.id === askFor.id);
  const [agents, related] = askFor
    ? await Promise.all([askableAgents(db, askFor.id), tasksAbout(db, "finance", askFor.id)])
    : [[], []];

  const multi = businesses.length > 1 && !scoped;
  const sourceNote = Object.entries(s.sources)
    .map(([k, v]) => `${v} ${k === "user_entered" ? "entered" : k}`)
    .join(", ");
  const rows: { label: string; value: number; sign?: "−" | "+"; total?: boolean; note?: string }[] =
    [
      { label: "Revenue", value: s.revenue },
      { label: "Refunds", value: s.refunds, sign: "−" },
      { label: "Other income", value: s.otherIncome, sign: "+" },
      { label: "Net revenue", value: s.netRevenue, total: true },
      { label: "Cost of goods sold", value: s.cogs, sign: "−" },
      { label: "Gross profit", value: s.grossProfit, total: true },
      { label: "Operating", value: s.expenses.operating },
      { label: "Ad spend", value: s.expenses.adSpend },
      { label: "Subscriptions", value: s.expenses.subscriptions },
      { label: "Other expenses", value: s.expenses.other },
      { label: "AI cost", value: s.expenses.ai, note: "Measured" },
      { label: "Operating expenses", value: s.operatingExpenses, sign: "−", total: true },
      { label: "Net profit", value: s.netProfit, total: true },
    ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Finance"
        description="Profit and loss from the entries you record, plus AI cost measured by Prince AI OS. No bank, store or payment account is connected, and nothing here moves money."
        actions={
          <Suspense>
            <OverviewFilters
              businesses={businesses.map((b) => ({ id: b.id, name: b.name }))}
              ranges={RANGES}
              defaultDays={30}
            />
          </Suspense>
        }
      />

      {businesses.length === 0 ? (
        <EmptyState
          title="No business yet"
          description="Finance entries belong to a business. Create one first."
        />
      ) : (
        <>
          {s.alerts.length > 0 && (
            <ul aria-label="Finance alerts" className="space-y-2">
              {s.alerts.map((a) => (
                <li
                  key={a}
                  className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
                >
                  <AlertTriangle className="size-4 shrink-0" aria-hidden /> {a}
                </li>
              ))}
            </ul>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Net revenue"
              value={s.hasRevenue ? formatMoney(s.netRevenue) : null}
              source={s.hasRevenue ? "user_entered" : "not_tracked"}
              hint={
                s.hasRevenue
                  ? "Revenue − refunds + other income"
                  : "Add a revenue entry to track it"
              }
            />
            <Stat
              label="Gross profit"
              value={s.hasRevenue ? formatMoney(s.grossProfit) : null}
              source={s.hasRevenue ? "user_entered" : "not_tracked"}
              hint={
                s.grossMarginPercent != null
                  ? `Gross margin ${s.grossMarginPercent.toFixed(1)}%`
                  : "Net revenue − cost of goods sold"
              }
            />
            <Stat
              label="Operating expenses"
              value={formatMoney(s.operatingExpenses)}
              hint={`Includes ${formatUsd(s.expenses.ai, { precise: s.expenses.ai > 0 && s.expenses.ai < 1 })} measured AI cost`}
            />
            <Stat
              label="Net profit"
              value={s.hasRevenue ? formatMoney(s.netProfit) : null}
              source={s.hasRevenue ? "user_entered" : "not_tracked"}
              hint={s.hasRevenue ? "Gross profit − operating expenses" : "Needs revenue entries"}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Profit and loss</CardTitle>
                    <CardDescription>
                      Last {days} days{scoped ? ` · ${scoped.name}` : " · all businesses"} ·{" "}
                      {s.entryCount} entr{s.entryCount === 1 ? "y" : "ies"}
                      {sourceNote && ` (${sourceNote})`}
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Profit and loss for the selected period</caption>
                    <tbody>
                      {rows.map((r) => (
                        <tr
                          key={r.label}
                          className={cn(r.total && "border-t border-border font-semibold")}
                        >
                          <th
                            scope="row"
                            className={cn(
                              "py-1.5 text-left font-normal",
                              r.total && "font-semibold",
                            )}
                          >
                            {r.label}
                            {r.note && (
                              <Badge tone="info" className="ml-2">
                                {r.note}
                              </Badge>
                            )}
                          </th>
                          <td className="py-1.5 text-right font-mono tabular-nums">
                            {r.sign && r.value !== 0 && (
                              <span className="text-muted-foreground">{r.sign} </span>
                            )}
                            {r.label === "AI cost"
                              ? formatUsd(r.value, { precise: r.value > 0 && r.value < 1 })
                              : formatMoney(r.value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!s.hasRevenue && (
                    <p className="text-xs text-muted-foreground">
                      No revenue is recorded for this period, so revenue and profit show as not
                      tracked rather than zero.
                    </p>
                  )}
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer select-none">
                      How these are calculated
                    </summary>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {s.formulas.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </details>
                </CardContent>
              </Card>

              <Card className="overflow-x-auto">
                <CardHeader>
                  <div>
                    <CardTitle>Entries</CardTitle>
                    <CardDescription>
                      Voiding keeps an entry in the history but stops it counting.
                    </CardDescription>
                  </div>
                </CardHeader>
                {entries.length === 0 ? (
                  <CardContent>
                    <EmptyState
                      title="No entries in this period"
                      description="Add revenue, costs and expenses as they happen, or estimates labelled as such."
                    />
                  </CardContent>
                ) : (
                  <table className="w-full text-sm">
                    <caption className="sr-only">Finance entries</caption>
                    <thead className="border-y border-border text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Date</th>
                        <th className="px-4 py-2.5 font-medium">Entry</th>
                        <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                        <th className="px-4 py-2.5 font-medium">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {entries.map((e) => (
                        <tr key={e.id} className={cn(e.voidedAt && "text-muted-foreground")}>
                          <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">
                            {e.occurredOn.toISOString().slice(0, 10)}
                          </td>
                          <td className="px-4 py-2">
                            <p className={cn(e.voidedAt && "line-through")}>{e.description}</p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                              {FINANCE_KIND_LABELS[e.kind]}
                              {multi && <span>· {e.business.name}</span>}
                              {e.source === "estimated" && <Badge tone="info">Estimated</Badge>}
                              {e.voidedAt && <Badge>Voided</Badge>}
                            </p>
                          </td>
                          <td className="px-4 py-2 text-right font-mono whitespace-nowrap tabular-nums">
                            {EXPENSE_KINDS.has(e.kind) ? "−" : ""}
                            {formatMoney(e.amountUsd)}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {e.canVoid && (
                              <ActionButton
                                variant="ghost"
                                action={voidFinanceEntryAction.bind(null, e.id)}
                                confirm={`Void "${e.description}"? It stays in the history but stops counting.`}
                                aria-label={`Void ${e.description}`}
                              >
                                <Ban /> Void
                              </ActionButton>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Add an entry</CardTitle>
                    <CardDescription>
                      Label estimates as estimates; they are counted but marked.
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  {writable.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Viewers can read finances but not add entries.
                    </p>
                  ) : (
                    <FinanceEntryForm
                      businesses={writable.map((b) => ({ value: b.id, label: b.name }))}
                      kinds={toOptions(FINANCE_KINDS, FINANCE_KIND_LABELS)}
                      defaultBusinessId={scoped?.id}
                    />
                  )}
                </CardContent>
              </Card>

              {askFor ? (
                <AgentPanel
                  subjectType="finance"
                  subjectId={askFor.id}
                  agents={agents}
                  defaultAgentId={preferredAgentId(agents, "financial-analyst")}
                  suggestions={[
                    "Review the last 90 days and point out where margin is being lost.",
                    "Which expenses look out of line with revenue, and what would you check first?",
                  ]}
                  modes={modes}
                  tasks={related}
                  canAsk={canAsk}
                  description={`The agent reads ${askFor.name}'s last 90 days of entries and measured AI cost. Its advice is a draft; it cannot move money.`}
                />
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle>Ask an agent</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      Choose one business in the filter above to ask the Financial Analyst about it.
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
