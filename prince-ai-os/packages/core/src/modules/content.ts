import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  ApprovalRequest,
  ContentFormat,
  ContentItem,
  ContentStage,
  PrismaClient,
} from "@prince/database";
import { accessibleBusinessIds, requireBusinessRole } from "../access";
import { requestApproval } from "../approval-store";
import { recordAudit } from "../audit";
import { ValidationError } from "../errors";
import {
  isoDay,
  loadScoped,
  longText,
  optionalDay,
  optionalUrl,
  parseInput,
  shortText,
} from "./records";

/**
 * Content Studio: ideas move through drafting and review, are approved for publication through the
 * approval system, and are marked published by a person. No publishing platform is connected, so
 * Prince AI OS never posts anything; approval records the go-ahead for the exact text approved.
 */

export const CONTENT_FORMATS = [
  "blog",
  "short_video",
  "long_video",
  "social_post",
  "email",
  "ad",
  "other",
] as const satisfies readonly ContentFormat[];

export const CONTENT_STAGES = [
  "idea",
  "drafting",
  "review",
  "approved",
  "published",
] as const satisfies readonly ContentStage[];

/** Stages a person can move an item between directly. */
const MANUAL_STAGES: ContentStage[] = ["idea", "drafting", "review"];

export const APPROVE_CONTENT_ACTION = "content.approve_publication";

export const contentInput = z.object({
  businessId: z.string().min(1, "Choose a business"),
  title: shortText("Title", 200),
  format: z.enum(CONTENT_FORMATS, { message: "Choose a format" }),
  channel: z.string().trim().max(80).default(""),
  brief: longText(5_000),
  body: longText(50_000),
});
export type ContentInput = z.input<typeof contentInput>;

/** Fingerprint of what is being approved, so edits after a request invalidate it. */
function contentHash(item: Pick<ContentItem, "title" | "body" | "channel" | "format">) {
  return createHash("sha256")
    .update(`${item.format}\n${item.channel}\n${item.title}\n${item.body}`)
    .digest("hex")
    .slice(0, 32);
}

async function load(db: PrismaClient, userId: string, id: string, minRole: "viewer" | "member") {
  return loadScoped(
    db,
    userId,
    await db.contentItem.findUnique({ where: { id } }),
    "Content item",
    minRole,
  );
}

export async function createContentItem(db: PrismaClient, userId: string, raw: ContentInput) {
  const input = parseInput(contentInput, raw);
  await requireBusinessRole(db, userId, input.businessId, "member");
  return db.$transaction(async (tx) => {
    const item = await tx.contentItem.create({ data: { ...input, createdById: userId } });
    await recordAudit(tx, {
      actorType: "user",
      actorId: userId,
      businessId: input.businessId,
      action: "content.created",
      targetType: "content_item",
      targetId: item.id,
      summary: `Added content idea "${item.title}" (${item.format.replace("_", " ")})`,
    });
    return item;
  });
}

/**
 * Saves edits. Changing an approved item's text sends it back to drafting: the approval covered
 * the exact text, not whatever it becomes. Published items are a record and cannot change.
 */
export async function updateContentItem(
  db: PrismaClient,
  userId: string,
  id: string,
  raw: ContentInput,
) {
  const { record } = await load(db, userId, id, "member");
  if (record.stage === "published")
    throw new ValidationError("Published items are kept as a record and cannot be edited");
  const input = parseInput(contentInput, { ...raw, businessId: record.businessId });
  const textChanged = contentHash(record) !== contentHash({ ...record, ...input });
  const resetApproval = record.stage === "approved" && textChanged;
  if (!textChanged && input.brief === record.brief) return record;
  return db.$transaction(async (tx) => {
    const item = await tx.contentItem.update({
      where: { id },
      data: {
        ...input,
        ...(resetApproval ? { stage: "drafting" as const, scheduledFor: null } : {}),
      },
    });
    // A pending request covers the old text; withdraw it rather than let it fail later.
    const withdrawn = textChanged
      ? await tx.approvalRequest.updateMany({
          where: { targetType: "content_item", targetId: id, status: "pending" },
          data: { status: "cancelled", decidedById: userId, decidedAt: new Date() },
        })
      : { count: 0 };
    await recordAudit(tx, {
      actorType: "user",
      actorId: userId,
      businessId: record.businessId,
      action: "content.updated",
      targetType: "content_item",
      targetId: id,
      summary: `Edited "${item.title}"${resetApproval ? "; its approval no longer applies and it is back in drafting" : ""}${withdrawn.count ? "; the pending approval request was withdrawn" : ""}`,
    });
    return item;
  });
}

export async function setContentStage(
  db: PrismaClient,
  userId: string,
  id: string,
  stage: ContentStage,
) {
  const { record } = await load(db, userId, id, "member");
  if (!MANUAL_STAGES.includes(stage))
    throw new ValidationError(
      stage === "approved"
        ? "Request approval to approve an item for publication"
        : "Mark an approved item as published instead",
    );
  if (record.stage === "published")
    throw new ValidationError("Published items are kept as a record and cannot change stage");
  if (record.stage === stage) return record;
  return db.$transaction(async (tx) => {
    const item = await tx.contentItem.update({
      where: { id },
      data: { stage, ...(record.stage === "approved" ? { scheduledFor: null } : {}) },
    });
    await recordAudit(tx, {
      actorType: "user",
      actorId: userId,
      businessId: record.businessId,
      action: "content.stage_changed",
      targetType: "content_item",
      targetId: id,
      summary: `"${item.title}": ${record.stage} → ${stage}`,
    });
    return item;
  });
}

export const requestContentApprovalInput = z.object({ scheduledFor: optionalDay });

/** Asks an admin or owner to approve this exact text for publication on the planned date. */
export async function requestContentApproval(
  db: PrismaClient,
  userId: string,
  id: string,
  raw: z.input<typeof requestContentApprovalInput>,
) {
  const { record } = await load(db, userId, id, "member");
  const { scheduledFor } = parseInput(requestContentApprovalInput, raw);
  if (record.stage !== "review")
    throw new ValidationError("Move the item to review before requesting approval");
  if (!record.body.trim())
    throw new ValidationError("Add the text to approve before requesting approval");
  const { request } = await requestApproval(db, {
    businessId: record.businessId,
    action: APPROVE_CONTENT_ACTION,
    category: "publish",
    title: `Approve "${record.title}" for publication`,
    summary: `Marks this ${record.format.replace("_", " ")}${record.channel ? ` for ${record.channel}` : ""} as approved for publication${scheduledFor ? ` on ${isoDay(scheduledFor)}` : ""}. No publishing platform is connected: Prince AI OS will not post it; someone publishes it and records the link. Any later edit cancels the approval.`,
    reason: "Publishing content in the business's name needs an owner's or admin's approval.",
    payload: {
      contentItemId: id,
      contentHash: contentHash(record),
      scheduledFor: isoDay(scheduledFor),
    },
    estimatedCostUsd: 0,
    requestedBy: { type: "user", id: userId },
    target: { type: "content_item", id },
  });
  return request;
}

const approvalPayload = z.object({
  contentItemId: z.string(),
  contentHash: z.string(),
  scheduledFor: z.string().nullable(),
});

/** Approval handler: marks the item approved if its text is unchanged since the request. */
export async function executeApprovedContent(
  db: PrismaClient,
  approverId: string,
  request: ApprovalRequest,
) {
  const payload = approvalPayload.parse(request.payload);
  const item = await db.contentItem.findUnique({ where: { id: payload.contentItemId } });
  if (!item || item.businessId !== request.businessId || item.archivedAt)
    throw new ValidationError("The content item no longer exists");
  if (contentHash(item) !== payload.contentHash)
    throw new ValidationError("The content changed after approval was requested; request again");
  if (item.stage !== "review")
    throw new ValidationError(`The item is now in ${item.stage}, not review`);
  const scheduledFor = payload.scheduledFor ? new Date(`${payload.scheduledFor}T00:00:00Z`) : null;
  const updated = await db.contentItem.updateMany({
    where: { id: item.id, stage: "review" },
    data: { stage: "approved", scheduledFor },
  });
  if (updated.count === 0) throw new ValidationError("The item changed while being approved");
  await recordAudit(db, {
    actorType: "user",
    actorId: approverId,
    businessId: item.businessId,
    action: "content.approved",
    targetType: "content_item",
    targetId: item.id,
    summary: `Approved "${item.title}" for publication${payload.scheduledFor ? ` on ${payload.scheduledFor}` : ""}`,
  });
  return { contentItemId: item.id };
}

export const markPublishedInput = z.object({
  publishedUrl: optionalUrl,
});

/** Records that a person published an approved item outside Prince AI OS. */
export async function markContentPublished(
  db: PrismaClient,
  userId: string,
  id: string,
  raw: z.input<typeof markPublishedInput>,
) {
  const { record } = await load(db, userId, id, "member");
  const { publishedUrl } = parseInput(markPublishedInput, raw);
  if (record.stage !== "approved")
    throw new ValidationError("Only approved items can be marked as published");
  const updated = await db.contentItem.updateMany({
    where: { id, stage: "approved" },
    data: { stage: "published", publishedAt: new Date(), publishedUrl },
  });
  if (updated.count === 0) throw new ValidationError("The item changed meanwhile. Reload.");
  await recordAudit(db, {
    actorType: "user",
    actorId: userId,
    businessId: record.businessId,
    action: "content.marked_published",
    targetType: "content_item",
    targetId: id,
    summary: `Recorded "${record.title}" as published${publishedUrl ? ` at ${publishedUrl}` : ""}`,
  });
}

export async function archiveContentItem(db: PrismaClient, userId: string, id: string) {
  const { record } = await load(db, userId, id, "member");
  if (record.archivedAt) return;
  await db.contentItem.update({ where: { id }, data: { archivedAt: new Date() } });
  await db.approvalRequest.updateMany({
    where: { targetType: "content_item", targetId: id, status: "pending" },
    data: { status: "cancelled", decidedById: userId, decidedAt: new Date() },
  });
  await recordAudit(db, {
    actorType: "user",
    actorId: userId,
    businessId: record.businessId,
    action: "content.archived",
    targetType: "content_item",
    targetId: id,
    summary: `Archived "${record.title}"`,
  });
}

async function pendingApprovalsFor(db: PrismaClient, ids: string[]) {
  const pending = await db.approvalRequest.findMany({
    where: {
      targetType: "content_item",
      targetId: { in: ids },
      status: "pending",
      expiresAt: { gt: new Date() },
    },
    select: { id: true, targetId: true },
  });
  return new Map(pending.map((p) => [p.targetId!, p.id]));
}

export async function listContent(
  db: PrismaClient,
  userId: string,
  opts: { businessId?: string } = {},
) {
  const all = await accessibleBusinessIds(db, userId);
  const businessIds = opts.businessId ? all.filter((id) => id === opts.businessId) : all;
  const items = await db.contentItem.findMany({
    where: { businessId: { in: businessIds }, archivedAt: null },
    orderBy: [{ scheduledFor: "asc" }, { updatedAt: "desc" }],
    include: { business: { select: { id: true, name: true } } },
  });
  const pending = await pendingApprovalsFor(
    db,
    items.map((i) => i.id),
  );
  return items.map((i) => ({ ...i, pendingApprovalId: pending.get(i.id) ?? null }));
}

export async function getContentItem(db: PrismaClient, userId: string, id: string) {
  const item = await db.contentItem.findUnique({
    where: { id },
    include: { business: { select: { id: true, name: true } } },
  });
  const { role } = await loadScoped(db, userId, item, "Content item", "viewer");
  const approvals = await db.approvalRequest.findMany({
    where: { targetType: "content_item", targetId: id },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  const pending = approvals.find((a) => a.status === "pending" && a.expiresAt > new Date());
  return {
    item: item!,
    approvals,
    pendingApprovalId: pending?.id ?? null,
    canEdit: role !== "viewer",
  };
}

export function contentContext(item: ContentItem) {
  return [
    `Content: ${item.title} (${item.format.replace("_", " ")}${item.channel ? ` for ${item.channel}` : ""}; stage: ${item.stage})`,
    item.brief && `Brief: ${item.brief}`,
    item.body && `Current draft:\n${item.body.slice(0, 8_000)}`,
  ]
    .filter(Boolean)
    .join("\n");
}
