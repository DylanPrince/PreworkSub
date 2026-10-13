import { z } from "zod";
import type { ApprovalRequest, Campaign, PrismaClient } from "@prince/database";
import { accessibleBusinessIds, requireBusinessRole } from "../access";
import { requestApproval } from "../approval-store";
import { recordAudit } from "../audit";
import { ValidationError } from "../errors";
import {
  isoDay,
  loadScoped,
  longText,
  num,
  optionalDay,
  optionalMoney,
  parseInput,
  shortText,
} from "./records";

/**
 * Marketing: campaign plans with audience, channels, planned budget and dates. Launching a campaign
 * needs approval (it spends money or publishes ads). No ad platform is connected, so approval
 * records the go-ahead for the exact budget and dates; nothing is launched or spent from here, and
 * performance is not tracked until an ad platform integration exists.
 */

export const APPROVE_CAMPAIGN_ACTION = "marketing.approve_launch";

export const campaignInput = z
  .object({
    businessId: z.string().min(1, "Choose a business"),
    name: shortText("Name", 120),
    objective: shortText("Objective", 1_000),
    audience: longText(2_000),
    channels: z.union([z.string(), z.array(z.string())]).transform((v) =>
      (Array.isArray(v) ? v : v.split(","))
        .map((c) => c.trim())
        .filter(Boolean)
        .slice(0, 10),
    ),
    budgetUsd: optionalMoney,
    startsOn: optionalDay,
    endsOn: optionalDay,
    notes: longText(5_000),
  })
  .refine((c) => !c.startsOn || !c.endsOn || c.endsOn >= c.startsOn, {
    message: "The end date must be on or after the start date",
    path: ["endsOn"],
  });
export type CampaignInput = z.input<typeof campaignInput>;

/** What an approval covers: change any of these and the campaign needs approving again. */
function launchTerms(c: {
  budgetUsd: { toString(): string } | null;
  startsOn: Date | null;
  endsOn: Date | null;
  channels: string[];
}) {
  return {
    budgetUsd: num(c.budgetUsd),
    startsOn: isoDay(c.startsOn),
    endsOn: isoDay(c.endsOn),
    channels: [...c.channels].sort(),
  };
}
const sameTerms = (a: ReturnType<typeof launchTerms>, b: ReturnType<typeof launchTerms>) =>
  JSON.stringify(a) === JSON.stringify(b);

async function load(db: PrismaClient, userId: string, id: string, minRole: "viewer" | "member") {
  return loadScoped(
    db,
    userId,
    await db.campaign.findUnique({ where: { id } }),
    "Campaign",
    minRole,
  );
}

export async function createCampaign(db: PrismaClient, userId: string, raw: CampaignInput) {
  const input = parseInput(campaignInput, raw);
  await requireBusinessRole(db, userId, input.businessId, "member");
  return db.$transaction(async (tx) => {
    const c = await tx.campaign.create({ data: { ...input, createdById: userId } });
    await recordAudit(tx, {
      actorType: "user",
      actorId: userId,
      businessId: input.businessId,
      action: "campaign.created",
      targetType: "campaign",
      targetId: c.id,
      summary: `Planned campaign "${c.name}"`,
    });
    return c;
  });
}

/** Saves edits. Changing an approved campaign's budget, dates or channels returns it to planning. */
export async function updateCampaign(
  db: PrismaClient,
  userId: string,
  id: string,
  raw: CampaignInput,
) {
  const { record } = await load(db, userId, id, "member");
  const input = parseInput(campaignInput, { ...raw, businessId: record.businessId });
  if (record.status === "ended") throw new ValidationError("Ended campaigns cannot be edited");
  const termsChanged = !sameTerms(launchTerms(record), launchTerms({ ...record, ...input }));
  const reset = record.status === "approved" && termsChanged;
  return db.$transaction(async (tx) => {
    const c = await tx.campaign.update({
      where: { id },
      data: { ...input, ...(reset ? { status: "planning" as const } : {}) },
    });
    const withdrawn = termsChanged
      ? await tx.approvalRequest.updateMany({
          where: { targetType: "campaign", targetId: id, status: "pending" },
          data: { status: "cancelled", decidedById: userId, decidedAt: new Date() },
        })
      : { count: 0 };
    await recordAudit(tx, {
      actorType: "user",
      actorId: userId,
      businessId: record.businessId,
      action: "campaign.updated",
      targetType: "campaign",
      targetId: id,
      summary: `Edited "${c.name}"${reset ? "; its approval no longer applies and it is back in planning" : ""}${withdrawn.count ? "; the pending approval request was withdrawn" : ""}`,
    });
    return c;
  });
}

/** Asks an admin or owner to approve launching the campaign with its current budget and dates. */
export async function requestCampaignApproval(db: PrismaClient, userId: string, id: string) {
  const { record } = await load(db, userId, id, "member");
  if (record.status !== "planning")
    throw new ValidationError(`This campaign is already ${record.status}`);
  const terms = launchTerms(record);
  const missing = [
    terms.budgetUsd == null && "a budget",
    !terms.startsOn && "a start date",
    terms.channels.length === 0 && "at least one channel",
  ].filter(Boolean);
  if (missing.length)
    throw new ValidationError(`Add ${missing.join(", ")} before requesting approval`);
  const spends = (terms.budgetUsd ?? 0) > 0;
  const { request } = await requestApproval(db, {
    businessId: record.businessId,
    action: APPROVE_CAMPAIGN_ACTION,
    category: spends ? "spend" : "publish",
    title: `Approve launching "${record.name}"`,
    summary: `Approves launching "${record.name}" on ${terms.channels.join(", ")} from ${terms.startsOn}${terms.endsOn ? ` to ${terms.endsOn}` : ""} with a budget of up to $${(terms.budgetUsd ?? 0).toFixed(2)}. No ad platform is connected: Prince AI OS will not launch it or spend anything; someone launches it in the ad platform. Changing the budget, dates or channels cancels the approval.`,
    reason: spends
      ? "The campaign spends money on advertising."
      : "The campaign publishes ads in the business's name.",
    payload: { campaignId: id, ...terms },
    estimatedCostUsd: terms.budgetUsd,
    requestedBy: { type: "user", id: userId },
    target: { type: "campaign", id },
  });
  return request;
}

const approvalPayload = z.object({
  campaignId: z.string(),
  budgetUsd: z.number().nullable(),
  startsOn: z.string().nullable(),
  endsOn: z.string().nullable(),
  channels: z.array(z.string()),
});

/** Approval handler: approves the campaign if its terms are unchanged since the request. */
export async function executeApprovedCampaign(
  db: PrismaClient,
  approverId: string,
  request: ApprovalRequest,
) {
  const { campaignId, ...terms } = approvalPayload.parse(request.payload);
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.businessId !== request.businessId || campaign.archivedAt)
    throw new ValidationError("The campaign no longer exists");
  if (!sameTerms(launchTerms(campaign), terms))
    throw new ValidationError("The budget, dates or channels changed; request approval again");
  const updated = await db.campaign.updateMany({
    where: { id: campaignId, status: "planning" },
    data: { status: "approved" },
  });
  if (updated.count === 0) throw new ValidationError(`The campaign is ${campaign.status}`);
  await recordAudit(db, {
    actorType: "user",
    actorId: approverId,
    businessId: campaign.businessId,
    action: "campaign.approved",
    targetType: "campaign",
    targetId: campaignId,
    summary: `Approved launching "${campaign.name}" with a budget of up to $${(terms.budgetUsd ?? 0).toFixed(2)}`,
  });
  return { campaignId };
}

export async function endCampaign(db: PrismaClient, userId: string, id: string) {
  const { record } = await load(db, userId, id, "member");
  if (record.status === "ended") return;
  await db.campaign.update({ where: { id }, data: { status: "ended" } });
  await db.approvalRequest.updateMany({
    where: { targetType: "campaign", targetId: id, status: "pending" },
    data: { status: "cancelled", decidedById: userId, decidedAt: new Date() },
  });
  await recordAudit(db, {
    actorType: "user",
    actorId: userId,
    businessId: record.businessId,
    action: "campaign.ended",
    targetType: "campaign",
    targetId: id,
    summary: `Marked "${record.name}" as ended`,
  });
}

export async function listCampaigns(
  db: PrismaClient,
  userId: string,
  opts: { businessId?: string } = {},
) {
  const all = await accessibleBusinessIds(db, userId);
  const businessIds = opts.businessId ? all.filter((id) => id === opts.businessId) : all;
  const campaigns = await db.campaign.findMany({
    where: { businessId: { in: businessIds }, archivedAt: null },
    orderBy: [{ status: "asc" }, { startsOn: "asc" }, { createdAt: "desc" }],
    include: { business: { select: { id: true, name: true } } },
  });
  const pending = await db.approvalRequest.findMany({
    where: {
      targetType: "campaign",
      targetId: { in: campaigns.map((c) => c.id) },
      status: "pending",
      expiresAt: { gt: new Date() },
    },
    select: { id: true, targetId: true },
  });
  const pendingFor = new Map(pending.map((p) => [p.targetId!, p.id]));
  return campaigns.map((c) => ({
    ...c,
    budgetUsd: num(c.budgetUsd),
    pendingApprovalId: pendingFor.get(c.id) ?? null,
  }));
}

export async function getCampaign(db: PrismaClient, userId: string, id: string) {
  const campaign = await db.campaign.findUnique({
    where: { id },
    include: { business: { select: { id: true, name: true } } },
  });
  const { role } = await loadScoped(db, userId, campaign, "Campaign", "viewer");
  const approvals = await db.approvalRequest.findMany({
    where: { targetType: "campaign", targetId: id },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  const pending = approvals.find((a) => a.status === "pending" && a.expiresAt > new Date());
  return {
    campaign: { ...campaign!, budgetUsd: num(campaign!.budgetUsd) },
    approvals,
    pendingApprovalId: pending?.id ?? null,
    canEdit: role !== "viewer",
  };
}

export function campaignContext(c: Campaign) {
  const t = launchTerms(c);
  return [
    `Campaign: ${c.name} (status: ${c.status})`,
    `Objective: ${c.objective}`,
    c.audience && `Audience: ${c.audience}`,
    `Channels: ${t.channels.length ? t.channels.join(", ") : "not chosen"}`,
    `Planned budget: ${t.budgetUsd == null ? "not set" : `$${t.budgetUsd.toFixed(2)}`}; dates: ${t.startsOn ?? "not set"} to ${t.endsOn ?? "not set"}`,
    c.notes && `Notes: ${c.notes}`,
    "Performance data: not available (no ad platform connected).",
  ]
    .filter(Boolean)
    .join("\n");
}
