import { z } from "zod";
import type { FinanceKind, PrismaClient } from "@prince/database";
import { accessibleBusinessIds, requireBusinessRole } from "../access";
import { recordAudit } from "../audit";
import { ValidationError } from "../errors";
import { day, loadScoped, money, num, parseInput, shortText } from "./records";

/**
 * Finance: revenue and expense records entered by people (or imported later), plus the AI cost
 * Prince AI OS measures itself. Every figure keeps its source, every total shows its formula, and
 * nothing here moves money.
 */

export const FINANCE_KINDS = [
  "revenue",
  "refund",
  "cogs",
  "operating_expense",
  "ad_spend",
  "subscription",
  "other_income",
  "other_expense",
] as const satisfies readonly FinanceKind[];

export const FINANCE_KIND_LABELS: Record<FinanceKind, string> = {
  revenue: "Revenue",
  refund: "Refund",
  cogs: "Cost of goods sold",
  operating_expense: "Operating expense",
  ad_spend: "Ad spend",
  subscription: "Subscription",
  other_income: "Other income",
  other_expense: "Other expense",
};

export const financeEntryInput = z.object({
  businessId: z.string().min(1, "Choose a business"),
  kind: z.enum(FINANCE_KINDS, { message: "Choose a type" }),
  amountUsd: money.refine((n) => n > 0, "Enter an amount above zero"),
  occurredOn: day,
  description: shortText("Description", 300),
  source: z.enum(["user_entered", "estimated"]).default("user_entered"),
});
export type FinanceEntryInput = z.input<typeof financeEntryInput>;

export async function createFinanceEntry(db: PrismaClient, userId: string, raw: FinanceEntryInput) {
  const input = parseInput(financeEntryInput, raw);
  await requireBusinessRole(db, userId, input.businessId, "member");
  if (input.occurredOn.getTime() > Date.now() + 366 * 86_400_000)
    throw new ValidationError("Check the highlighted fields", {
      occurredOn: ["Use a date within the next year"],
    });
  return db.$transaction(async (tx) => {
    const entry = await tx.financeEntry.create({ data: { ...input, createdById: userId } });
    await recordAudit(tx, {
      actorType: "user",
      actorId: userId,
      businessId: input.businessId,
      action: "finance.entry_created",
      targetType: "finance_entry",
      targetId: entry.id,
      summary: `Recorded ${FINANCE_KIND_LABELS[input.kind].toLowerCase()} of $${input.amountUsd.toFixed(2)} (${input.source.replace("_", " ")}): ${input.description}`,
    });
    return entry;
  });
}

/** Voids an entry: it stops counting but stays in the history. */
export async function voidFinanceEntry(db: PrismaClient, userId: string, entryId: string) {
  const { record } = await loadScoped(
    db,
    userId,
    await db.financeEntry.findUnique({ where: { id: entryId } }),
    "Finance entry",
    "member",
  );
  const updated = await db.financeEntry.updateMany({
    where: { id: entryId, voidedAt: null },
    data: { voidedAt: new Date() },
  });
  if (updated.count === 0) throw new ValidationError("This entry was already voided");
  await recordAudit(db, {
    actorType: "user",
    actorId: userId,
    businessId: record.businessId,
    action: "finance.entry_voided",
    targetType: "finance_entry",
    targetId: entryId,
    summary: `Voided ${FINANCE_KIND_LABELS[record.kind].toLowerCase()} of $${Number(record.amountUsd).toFixed(2)}: ${record.description}`,
  });
}

export interface FinancePeriod {
  from: Date;
  /** Exclusive. */
  to: Date;
}

export function lastDays(days: number, now = new Date()): FinancePeriod {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return { from: new Date(to.getTime() - days * 86_400_000), to };
}

/**
 * Profit and loss for a period. Totals come only from recorded entries and measured AI cost; a
 * period without revenue entries reports revenue as not tracked rather than as zero.
 */
export async function financeSummary(
  db: PrismaClient,
  businessIds: string[],
  period: FinancePeriod,
) {
  const [groups, sources, ai] = await Promise.all([
    db.financeEntry.groupBy({
      by: ["kind"],
      where: {
        businessId: { in: businessIds },
        voidedAt: null,
        occurredOn: { gte: period.from, lt: period.to },
      },
      _sum: { amountUsd: true },
      _count: { _all: true },
    }),
    db.financeEntry.groupBy({
      by: ["source"],
      where: {
        businessId: { in: businessIds },
        voidedAt: null,
        occurredOn: { gte: period.from, lt: period.to },
      },
      _count: { _all: true },
    }),
    db.agentRun.aggregate({
      where: { businessId: { in: businessIds }, queuedAt: { gte: period.from, lt: period.to } },
      _sum: { costUsd: true },
    }),
  ]);
  const sum = (kind: FinanceKind) =>
    Number(groups.find((g) => g.kind === kind)?._sum.amountUsd ?? 0);
  const count = groups.reduce((n, g) => n + g._count._all, 0);
  const round = (n: number) => Math.round(n * 100) / 100;

  const revenue = sum("revenue");
  const refunds = sum("refund");
  const otherIncome = sum("other_income");
  const netRevenue = round(revenue - refunds + otherIncome);
  const cogs = sum("cogs");
  const grossProfit = round(netRevenue - cogs);
  const aiCostUsd = Number(ai._sum.costUsd ?? 0);
  const expenses = {
    operating: sum("operating_expense"),
    adSpend: sum("ad_spend"),
    subscriptions: sum("subscription"),
    other: sum("other_expense"),
    ai: aiCostUsd,
  };
  const operatingExpenses = round(
    expenses.operating + expenses.adSpend + expenses.subscriptions + expenses.other + expenses.ai,
  );
  const netProfit = round(grossProfit - operatingExpenses);
  const hasRevenue = groups.some((g) => g.kind === "revenue" || g.kind === "other_income");

  const alerts: string[] = [];
  if (hasRevenue && grossProfit < 0)
    alerts.push("Gross profit is negative: cost of goods exceeds net revenue.");
  if (hasRevenue && netProfit < 0) alerts.push("Net profit is negative for this period.");
  if (hasRevenue && netRevenue > 0 && expenses.adSpend > netRevenue * 0.5)
    alerts.push("Ad spend is more than half of net revenue.");

  return {
    period,
    entryCount: count,
    sources: Object.fromEntries(sources.map((s) => [s.source, s._count._all])) as Partial<
      Record<"user_entered" | "imported" | "estimated", number>
    >,
    hasRevenue,
    revenue,
    refunds,
    otherIncome,
    netRevenue,
    cogs,
    grossProfit,
    grossMarginPercent: netRevenue > 0 ? round((grossProfit / netRevenue) * 100) : null,
    expenses,
    operatingExpenses,
    netProfit,
    alerts,
    formulas: [
      "Net revenue = revenue − refunds + other income",
      "Gross profit = net revenue − cost of goods sold",
      "Operating expenses = operating + ad spend + subscriptions + other expenses + AI cost (measured)",
      "Net profit = gross profit − operating expenses",
    ],
  };
}

export async function getFinance(
  db: PrismaClient,
  userId: string,
  opts: { businessId?: string; days?: number } = {},
) {
  const all = await accessibleBusinessIds(db, userId);
  const businessIds = opts.businessId ? all.filter((id) => id === opts.businessId) : all;
  const days = Math.min(Math.max(opts.days ?? 30, 1), 366);
  const period = lastDays(days);
  const [summary, entries, writable] = await Promise.all([
    financeSummary(db, businessIds, period),
    db.financeEntry.findMany({
      where: { businessId: { in: businessIds }, occurredOn: { gte: period.from, lt: period.to } },
      orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
      take: 200,
      include: { business: { select: { id: true, name: true } } },
    }),
    db.membership.findMany({
      where: {
        userId,
        businessId: { in: businessIds },
        role: { in: ["member", "admin", "owner"] },
      },
      select: { businessId: true },
    }),
  ]);
  const canWrite = new Set(writable.map((m) => m.businessId));
  return {
    days,
    summary,
    entries: entries.map((e) => ({
      ...e,
      amountUsd: num(e.amountUsd)!,
      canVoid: !e.voidedAt && canWrite.has(e.businessId),
    })),
  };
}
