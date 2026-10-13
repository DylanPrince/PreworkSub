import { z } from "zod";
import type { ApprovalRequest, Prisma, PrismaClient } from "@prince/database";
import { accessibleBusinessIds, requireBusinessRole } from "./access";
import { expireStaleApprovals } from "./approval-store";
import { recordAudit } from "./audit";
import { DISPATCH_WORKSTREAM_ACTION, executeApprovedDispatch } from "./commands";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import type { RunQueue } from "./run-queue";
import { runPolicyFromEnv, type RunPolicy } from "./tasks";
import {
  executeApprovedWorkflowStep,
  RUN_WORKFLOW_STEP_ACTION,
  settleWorkflowRun,
} from "./workflows";

/**
 * Approval system. Consequential actions are not performed by the code that wants them: that code
 * records an ApprovalRequest (approval-store.ts), and the action runs only here, after a business
 * admin or owner approves it. Each decision is a conditional status change, so concurrent clicks
 * execute an action at most once, and every request, decision and outcome is audited.
 */

export interface ApprovalContext {
  db: PrismaClient;
  queue: RunQueue;
  policy: RunPolicy;
  approverId: string;
  request: ApprovalRequest;
}

export interface ApprovalActionHandler {
  /** Short description shown in the queue. */
  label: string;
  /** Performs the approved action as the approver. Throws to mark the request failed. */
  execute(ctx: ApprovalContext): Promise<Prisma.InputJsonValue>;
}

/** The only actions an approval can run. Unknown actions fail instead of running. */
export const APPROVAL_HANDLERS: Record<string, ApprovalActionHandler> = {
  [DISPATCH_WORKSTREAM_ACTION]: {
    label: "Dispatch a flagged workstream",
    execute: ({ db, queue, approverId, request, policy }) =>
      executeApprovedDispatch(db, queue, approverId, request, policy),
  },
  [RUN_WORKFLOW_STEP_ACTION]: {
    label: "Run a workflow step",
    execute: ({ db, queue, approverId, request, policy }) =>
      executeApprovedWorkflowStep(db, queue, approverId, request, policy),
  },
};

/** Lets the work an approval belongs to react to a request that will not run. */
async function afterDeclined(db: PrismaClient, request: ApprovalRequest) {
  if (request.targetType === "workflow_run" && request.targetId)
    await settleWorkflowRun(db, request.targetId);
}

export const CATEGORY_LABELS: Record<ApprovalRequest["category"], string> = {
  spend: "Spends money",
  publish: "Publishes content",
  purchase: "Purchases",
  contact_customers: "Contacts customers",
  deploy: "Deploys",
  credentials: "Changes credentials",
  legal: "Legal",
  destructive: "Deletes or overwrites data",
  owner_flagged: "Flagged for owner approval",
};

async function requesterNames(db: PrismaClient, requests: ApprovalRequest[]) {
  const userIds = [
    ...new Set(
      requests
        .filter((r) => r.requestedByType === "user" && r.requestedById)
        .map((r) => r.requestedById!),
    ),
  ];
  const agentIds = [
    ...new Set(
      requests
        .filter((r) => r.requestedByType === "agent" && r.requestedById)
        .map((r) => r.requestedById!),
    ),
  ];
  const [users, agents] = await Promise.all([
    db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    db.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } }),
  ]);
  const names = new Map([...users, ...agents].map((x) => [x.id, x.name]));
  return (r: ApprovalRequest) =>
    r.requestedByType === "system" ? "System" : (names.get(r.requestedById ?? "") ?? "Unknown");
}

export async function listApprovals(
  db: PrismaClient,
  userId: string,
  opts: { businessId?: string; decidedLimit?: number } = {},
) {
  await expireStaleApprovals(db);
  const ids = await accessibleBusinessIds(db, userId);
  const businessIds = opts.businessId ? ids.filter((id) => id === opts.businessId) : ids;
  const include = {
    business: { select: { id: true, name: true } },
    decidedBy: { select: { name: true } },
  } as const;
  const [pending, decided, adminOf] = await Promise.all([
    db.approvalRequest.findMany({
      where: { businessId: { in: businessIds }, status: "pending" },
      orderBy: { createdAt: "asc" },
      include,
    }),
    db.approvalRequest.findMany({
      where: { businessId: { in: businessIds }, status: { not: "pending" } },
      orderBy: { updatedAt: "desc" },
      take: opts.decidedLimit ?? 50,
      include,
    }),
    db.membership.findMany({
      where: { userId, businessId: { in: businessIds }, role: { in: ["admin", "owner"] } },
      select: { businessId: true },
    }),
  ]);
  const nameOf = await requesterNames(db, [...pending, ...decided]);
  const canDecideIn = new Set(adminOf.map((m) => m.businessId));
  const shape = <T extends ApprovalRequest>(r: T) => ({
    ...r,
    requestedByName: nameOf(r),
    canDecide: r.status === "pending" && canDecideIn.has(r.businessId),
  });
  return { pending: pending.map(shape), decided: decided.map(shape) };
}

export async function countPendingApprovals(db: PrismaClient, businessIds: string[]) {
  return db.approvalRequest.count({
    where: { businessId: { in: businessIds }, status: "pending", expiresAt: { gt: new Date() } },
  });
}

export async function getApproval(db: PrismaClient, userId: string, id: string) {
  await expireStaleApprovals(db);
  const request = await db.approvalRequest.findUnique({
    where: { id },
    include: {
      business: { select: { id: true, name: true } },
      decidedBy: { select: { name: true } },
    },
  });
  if (!request) throw new NotFoundError("Approval request");
  const role = await requireBusinessRole(db, userId, request.businessId, "viewer");
  const nameOf = await requesterNames(db, [request]);
  const isAdmin = role === "admin" || role === "owner";
  return {
    request,
    requestedByName: nameOf(request),
    actionLabel: APPROVAL_HANDLERS[request.action]?.label ?? request.action,
    canDecide: request.status === "pending" && isAdmin,
    canCancel:
      request.status === "pending" &&
      (isAdmin || (request.requestedByType === "user" && request.requestedById === userId)),
  };
}

export const decideApprovalInput = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(1000, "Keep the note under 1,000 characters").default(""),
});
export type DecideApprovalInput = z.input<typeof decideApprovalInput>;

/**
 * Approves or rejects a pending request. Only business admins and owners decide. Approval runs the
 * registered action at once, as the approver; its outcome (executed or failed) is stored on the
 * request. A rejection blocks identical requests (see approval-store.ts).
 */
export async function decideApproval(
  db: PrismaClient,
  queue: RunQueue,
  userId: string,
  id: string,
  raw: DecideApprovalInput,
  policy: RunPolicy = runPolicyFromEnv(),
  now = new Date(),
) {
  const parsed = decideApprovalInput.safeParse(raw);
  if (!parsed.success)
    throw new ValidationError("Check the decision", z.flattenError(parsed.error).fieldErrors);
  const { decision, note } = parsed.data;
  const existing = await db.approvalRequest.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("Approval request");
  const role = await requireBusinessRole(db, userId, existing.businessId, "viewer");
  if (role !== "admin" && role !== "owner")
    throw new ForbiddenError("Only business admins and owners can approve or reject requests.");

  const status = decision === "approve" ? "approved" : "rejected";
  // Conditional update: only one decision can win, and never on an expired request.
  const claimed = await db.approvalRequest.updateMany({
    where: { id, status: "pending", expiresAt: { gt: now } },
    data: { status, decidedById: userId, decidedAt: now, decisionNote: note },
  });
  if (claimed.count === 0) {
    const current = await db.approvalRequest.findUniqueOrThrow({ where: { id } });
    if (current.status === "pending") {
      await db.approvalRequest.updateMany({
        where: { id, status: "pending" },
        data: { status: "expired" },
      });
      throw new ValidationError("This request has expired and can no longer be decided.");
    }
    throw new ValidationError(`This request was already ${current.status}.`);
  }
  await recordAudit(db, {
    actorType: "user",
    actorId: userId,
    businessId: existing.businessId,
    action: `approval.${status}`,
    targetType: "approval_request",
    targetId: id,
    summary:
      `${status === "approved" ? "Approved" : "Rejected"}: ${existing.title}${note ? ` (${note})` : ""}`.slice(
        0,
        500,
      ),
  });
  if (status === "rejected") {
    const rejected = await db.approvalRequest.findUniqueOrThrow({ where: { id } });
    await afterDeclined(db, rejected);
    return rejected;
  }

  const request = await db.approvalRequest.findUniqueOrThrow({ where: { id } });
  const handler = APPROVAL_HANDLERS[request.action];
  try {
    if (!handler) throw new Error(`No handler is registered for "${request.action}"`);
    const result = await handler.execute({ db, queue, policy, approverId: userId, request });
    const done = await db.approvalRequest.update({
      where: { id },
      data: { status: "executed", executedAt: new Date(), result },
    });
    await recordAudit(db, {
      actorType: "user",
      actorId: userId,
      businessId: request.businessId,
      action: "approval.executed",
      targetType: "approval_request",
      targetId: id,
      summary: `Carried out: ${request.title}`.slice(0, 500),
    });
    return done;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await db.approvalRequest.update({
      where: { id },
      data: { status: "failed", errorMessage: message.slice(0, 1000) },
    });
    await recordAudit(db, {
      actorType: "system",
      businessId: request.businessId,
      action: "approval.failed",
      targetType: "approval_request",
      targetId: id,
      summary: `Approved but could not be carried out: ${request.title}: ${message}`.slice(0, 500),
    });
    await afterDeclined(db, failed);
    return failed;
  }
}

/** Withdraws a pending request. Its requester or a business admin/owner may cancel it. */
export async function cancelApproval(db: PrismaClient, userId: string, id: string) {
  const { request, canCancel } = await getApproval(db, userId, id);
  if (!canCancel) {
    if (request.status !== "pending")
      throw new ValidationError(`This request was already ${request.status}.`);
    throw new ForbiddenError("Only the requester or a business admin can withdraw this request.");
  }
  const claimed = await db.approvalRequest.updateMany({
    where: { id, status: "pending" },
    data: { status: "cancelled", decidedById: userId, decidedAt: new Date() },
  });
  if (claimed.count === 0) throw new ValidationError("This request was just decided. Reload.");
  await recordAudit(db, {
    actorType: "user",
    actorId: userId,
    businessId: request.businessId,
    action: "approval.cancelled",
    targetType: "approval_request",
    targetId: id,
    summary: `Withdrawn: ${request.title}`.slice(0, 500),
  });
  await afterDeclined(db, request);
}
