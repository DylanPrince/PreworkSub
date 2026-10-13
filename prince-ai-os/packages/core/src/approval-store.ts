import { createHash } from "node:crypto";
import type { ActorType, ApprovalCategory, Prisma, PrismaClient } from "@prince/database";
import { recordAudit } from "./audit";
import { ForbiddenError } from "./errors";

/** How long a request waits for a decision before it expires. */
export const APPROVAL_TTL_MS = 72 * 3_600_000;
/** How long a rejection blocks an identical request (same business, action and payload). */
export const REJECTION_BLOCK_MS = 30 * 86_400_000;

export interface ApprovalRequestInput {
  businessId: string;
  /** Key of a handler registered in approvals.ts. */
  action: string;
  category: ApprovalCategory;
  title: string;
  /** What happens if the request is approved, in plain words. */
  summary: string;
  /** Why the action needs a human decision. */
  reason: string;
  payload: Record<string, Prisma.InputJsonValue>;
  estimatedCostUsd?: number | null;
  requestedBy: { type: ActorType; id: string | null };
  target?: { type: string; id: string };
  ttlMs?: number;
}

/** JSON with sorted keys, so equal payloads always hash the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function approvalFingerprint(businessId: string, action: string, payload: unknown): string {
  return createHash("sha256")
    .update(`${businessId}\n${action}\n${canonical(payload)}`)
    .digest("hex");
}

/**
 * Records that an action needs a human decision. Idempotent: an identical pending request is
 * returned instead of a duplicate. An identical request rejected within REJECTION_BLOCK_MS is
 * refused, so a rejected action cannot simply be asked for again (by any user or agent).
 */
export async function requestApproval(
  db: PrismaClient,
  input: ApprovalRequestInput,
  now = new Date(),
) {
  const fingerprint = approvalFingerprint(input.businessId, input.action, input.payload);
  return db.$transaction(async (tx) => {
    // Serialise requests for the same action so two callers cannot both create one.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${fingerprint}::text))`;
    await tx.approvalRequest.updateMany({
      where: { fingerprint, status: "pending", expiresAt: { lte: now } },
      data: { status: "expired" },
    });
    const pending = await tx.approvalRequest.findFirst({
      where: { fingerprint, status: "pending" },
    });
    if (pending) return { request: pending, created: false };

    const rejected = await tx.approvalRequest.findFirst({
      where: {
        fingerprint,
        status: "rejected",
        decidedAt: { gte: new Date(now.getTime() - REJECTION_BLOCK_MS) },
      },
      orderBy: { decidedAt: "desc" },
    });
    if (rejected?.decidedAt) {
      const until = new Date(rejected.decidedAt.getTime() + REJECTION_BLOCK_MS);
      throw new ForbiddenError(
        `This exact action was rejected on ${rejected.decidedAt.toISOString().slice(0, 10)} and cannot be requested again before ${until.toISOString().slice(0, 10)}. Change the request or ask the owner.`,
      );
    }

    const request = await tx.approvalRequest.create({
      data: {
        businessId: input.businessId,
        action: input.action,
        category: input.category,
        title: input.title.slice(0, 200),
        summary: input.summary.slice(0, 2000),
        reason: input.reason.slice(0, 1000),
        payload: input.payload,
        fingerprint,
        estimatedCostUsd: input.estimatedCostUsd ?? null,
        requestedByType: input.requestedBy.type,
        requestedById: input.requestedBy.id,
        targetType: input.target?.type ?? null,
        targetId: input.target?.id ?? null,
        expiresAt: new Date(now.getTime() + (input.ttlMs ?? APPROVAL_TTL_MS)),
      },
    });
    await recordAudit(tx, {
      actorType: input.requestedBy.type,
      actorId: input.requestedBy.id,
      businessId: input.businessId,
      action: "approval.requested",
      targetType: "approval_request",
      targetId: request.id,
      summary: `Approval requested: ${request.title}`.slice(0, 500),
    });
    return { request, created: true };
  });
}

/** Marks pending requests past their expiry as expired. Called before approvals are read. */
export async function expireStaleApprovals(db: PrismaClient, now = new Date()) {
  await db.approvalRequest.updateMany({
    where: { status: "pending", expiresAt: { lte: now } },
    data: { status: "expired" },
  });
}
