import { z } from "zod";
import type { PrismaClient, RunStatus, TaskStatus } from "@prince/database";
import { getServerEnv } from "@prince/shared";
import { getImplementedTemplate } from "@prince/agents";
import { recordAudit } from "./audit";
import { accessibleBusinessIds, requireBusinessRole } from "./access";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { getCurrentVersion } from "./agents";
import type { RunQueue } from "./run-queue";

export const createTaskInput = z.object({
  businessId: z.string().min(1, "Choose a business"),
  agentId: z.string().min(1, "Choose an agent"),
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(200),
  instructions: z
    .string()
    .trim()
    .min(10, "Describe the task in at least 10 characters")
    .max(20_000),
  runNow: z.boolean().default(false),
  idempotencyKey: z.string().uuid().optional(),
});
export type CreateTaskInput = z.input<typeof createTaskInput>;

export async function createTask(
  db: PrismaClient,
  queue: RunQueue,
  userId: string,
  raw: CreateTaskInput,
) {
  const parsed = createTaskInput.safeParse(raw);
  if (!parsed.success)
    throw new ValidationError("Invalid task", z.flattenError(parsed.error).fieldErrors);
  const input = parsed.data;
  await requireBusinessRole(db, userId, input.businessId, "member");
  const agent = await db.agent.findUnique({ where: { id: input.agentId } });
  if (!agent || (agent.businessId !== null && agent.businessId !== input.businessId)) {
    throw new ValidationError("Invalid task", {
      agentId: ["This agent is not available to the selected business"],
    });
  }

  const task = await db.$transaction(async (tx) => {
    const t = await tx.task.create({
      data: {
        businessId: input.businessId,
        agentId: input.agentId,
        title: input.title,
        instructions: input.instructions,
        createdById: userId,
      },
    });
    await recordAudit(tx, {
      actorType: "user",
      actorId: userId,
      businessId: t.businessId,
      action: "task.created",
      targetType: "task",
      targetId: t.id,
      summary: `Created task "${t.title}" for ${agent.name}`,
    });
    return t;
  });

  const run = input.runNow
    ? await requestRun(db, queue, userId, task.id, { idempotencyKey: input.idempotencyKey })
    : null;
  return { task, run };
}

export async function listTasks(
  db: PrismaClient,
  userId: string,
  opts: { businessId?: string } = {},
) {
  const ids = await accessibleBusinessIds(db, userId);
  const businessIds = opts.businessId ? ids.filter((id) => id === opts.businessId) : ids;
  return db.task.findMany({
    where: { businessId: { in: businessIds } },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      agent: { select: { id: true, name: true } },
      business: { select: { id: true, name: true } },
      runs: { orderBy: { queuedAt: "desc" }, take: 1 },
    },
  });
}

export async function getTask(db: PrismaClient, userId: string, taskId: string) {
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: {
      agent: { select: { id: true, name: true, status: true, templateKey: true } },
      business: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
      runs: {
        orderBy: { queuedAt: "desc" },
        include: { events: { orderBy: { createdAt: "asc" } } },
      },
    },
  });
  if (!task) throw new NotFoundError("Task");
  await requireBusinessRole(db, userId, task.businessId, "viewer");
  return task;
}

/** Maps a run's lifecycle onto its task so task lists show the latest execution state. */
export function taskStatusFor(run: RunStatus): TaskStatus {
  return run;
}

export async function requestRun(
  db: PrismaClient,
  queue: RunQueue,
  userId: string,
  taskId: string,
  opts: { idempotencyKey?: string } = {},
) {
  const task = await db.task.findUnique({ where: { id: taskId }, include: { agent: true } });
  if (!task) throw new NotFoundError("Task");
  await requireBusinessRole(db, userId, task.businessId, "member");

  const idempotencyKey = opts.idempotencyKey ?? crypto.randomUUID();
  const existing = await db.agentRun.findUnique({ where: { idempotencyKey } });
  if (existing) {
    if (existing.taskId !== taskId)
      throw new ForbiddenError("Idempotency key already used for another task");
    return existing;
  }

  if (task.agent.status !== "active") throw new ValidationError(`${task.agent.name} is disabled`);
  if (!getImplementedTemplate(task.agent.templateKey)) {
    throw new ValidationError(`${task.agent.name} does not have an executable configuration yet`);
  }
  const active = await db.agentRun.count({
    where: { taskId, status: { in: ["queued", "running"] } },
  });
  if (active > 0) throw new ValidationError("This task already has a run in progress");

  const version = await getCurrentVersion(db, task.agentId);
  const env = getServerEnv();
  const run = await db.$transaction(async (tx) => {
    const r = await tx.agentRun.create({
      data: {
        taskId,
        agentId: task.agentId,
        agentVersion: version.version,
        businessId: task.businessId,
        idempotencyKey,
        provider: env.AI_PROVIDER,
        model: env.AI_PROVIDER === "mock" ? "mock" : version.model,
        events: {
          create: {
            type: "queued",
            message: `Queued by user (agent v${version.version}, ${env.AI_PROVIDER})`,
          },
        },
      },
    });
    await tx.task.update({ where: { id: taskId }, data: { status: "queued" } });
    await recordAudit(tx, {
      actorType: "user",
      actorId: userId,
      businessId: task.businessId,
      action: "run.requested",
      targetType: "agent_run",
      targetId: r.id,
      summary: `Requested ${task.agent.name} run for "${task.title}"`,
    });
    return r;
  });

  try {
    await queue.enqueue(run.id, { attempts: version.maxAttempts });
  } catch (error) {
    // Keep Postgres truthful if Redis is unavailable: the run never reached the queue.
    await failRunImmediately(
      db,
      run.id,
      "queue_unavailable",
      `Could not enqueue job: ${(error as Error).message}`,
    );
    throw new ValidationError("The job queue is unavailable. Is Redis running?");
  }
  return run;
}

async function failRunImmediately(db: PrismaClient, runId: string, code: string, message: string) {
  const run = await db.agentRun.update({
    where: { id: runId },
    data: {
      status: "failed",
      errorCode: code,
      errorMessage: message,
      finishedAt: new Date(),
      events: { create: { type: "failed", message } },
    },
  });
  await db.task.update({ where: { id: run.taskId }, data: { status: "failed" } });
}

export async function cancelRun(db: PrismaClient, queue: RunQueue, userId: string, runId: string) {
  const run = await db.agentRun.findUnique({ where: { id: runId } });
  if (!run) throw new NotFoundError("Run");
  await requireBusinessRole(db, userId, run.businessId, "member");
  if (run.status !== "queued" && run.status !== "running") {
    throw new ValidationError(`Run is already ${run.status}`);
  }
  const removed = run.status === "queued" ? await queue.remove(runId) : false;
  await db.$transaction(async (tx) => {
    if (removed) {
      await tx.agentRun.update({
        where: { id: runId },
        data: {
          status: "cancelled",
          cancelRequestedAt: new Date(),
          finishedAt: new Date(),
          events: { create: { type: "cancelled", message: "Cancelled before execution" } },
        },
      });
      await tx.task.update({ where: { id: run.taskId }, data: { status: "cancelled" } });
    } else {
      // The worker polls for this flag and aborts the in-flight provider request.
      await tx.agentRun.update({
        where: { id: runId },
        data: {
          cancelRequestedAt: new Date(),
          events: { create: { type: "cancel_requested", message: "Cancellation requested" } },
        },
      });
    }
    await recordAudit(tx, {
      actorType: "user",
      actorId: userId,
      businessId: run.businessId,
      action: "run.cancel_requested",
      targetType: "agent_run",
      targetId: runId,
      summary: removed ? "Cancelled queued run" : "Requested cancellation of running run",
    });
  });
}

/** Retrying creates a new run so history keeps every attempt's cost and output. */
export async function retryRun(db: PrismaClient, queue: RunQueue, userId: string, runId: string) {
  const run = await db.agentRun.findUnique({ where: { id: runId } });
  if (!run) throw new NotFoundError("Run");
  if (run.status !== "failed" && run.status !== "cancelled") {
    throw new ValidationError("Only failed or cancelled runs can be retried");
  }
  return requestRun(db, queue, userId, run.taskId);
}
