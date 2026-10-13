import { z } from "zod";
import type { PrismaClient, RunStatus, TaskStatus } from "@prince/database";
import { getServerEnv } from "@prince/shared";
import { getContract } from "@prince/agents";
import type { ProviderName } from "@prince/ai";
import { recordAudit } from "./audit";
import { accessibleBusinessIds, requireBusinessRole } from "./access";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { getCurrentVersion } from "./agents";
import type { RunQueue } from "./run-queue";
import { getBudgetStatus, type BudgetLimits } from "./budget";

/** Server-side rules for which provider a run may use. Built from env in the app and worker. */
export interface RunPolicy {
  defaultProvider: ProviderName;
  anthropicConfigured: boolean;
  /** Mock (dry) runs are refused when APP_ENV=production. */
  allowMock: boolean;
  budget: BudgetLimits;
}

export function runPolicyFromEnv(): RunPolicy {
  const env = getServerEnv();
  return {
    defaultProvider: env.AI_PROVIDER,
    anthropicConfigured: Boolean(env.ANTHROPIC_API_KEY),
    allowMock: env.APP_ENV !== "production",
    budget: { dailyUsd: env.AI_DAILY_BUDGET_USD, monthlyUsd: env.AI_MONTHLY_BUDGET_USD },
  };
}

export interface RequestRunOptions {
  idempotencyKey?: string;
  /** "mock" requests a free dry run; omitted uses the configured default provider. */
  provider?: ProviderName;
  policy?: RunPolicy;
}

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
  kind: z.enum(["standard", "test"]).default("standard"),
});
export type CreateTaskInput = z.input<typeof createTaskInput>;

export async function createTask(
  db: PrismaClient,
  queue: RunQueue,
  userId: string,
  raw: CreateTaskInput,
  runOpts: Omit<RequestRunOptions, "idempotencyKey"> = {},
  /** Module record the task is about (set by the service that checked access to it). */
  subject?: { type: string; id: string },
) {
  const parsed = createTaskInput.safeParse(raw);
  if (!parsed.success)
    throw new ValidationError("Invalid task", z.flattenError(parsed.error).fieldErrors);
  const input = parsed.data;
  await requireBusinessRole(db, userId, input.businessId, "member");
  const agent = await db.agent.findUnique({ where: { id: input.agentId } });
  if (
    !agent ||
    agent.status === "archived" ||
    (agent.businessId !== null && agent.businessId !== input.businessId)
  ) {
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
        kind: input.kind,
        subjectType: subject?.type ?? null,
        subjectId: subject?.id ?? null,
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
    ? await requestRun(db, queue, userId, task.id, {
        ...runOpts,
        idempotencyKey: input.idempotencyKey,
      })
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
  opts: RequestRunOptions = {},
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

  if (task.agent.status !== "active")
    throw new ValidationError(`${task.agent.name} is ${task.agent.status}`);
  const version = await getCurrentVersion(db, task.agentId);
  if (!getContract(version.outputSchemaKey)) {
    throw new ValidationError(`${task.agent.name} does not have an executable configuration yet`);
  }
  const active = await db.agentRun.count({
    where: { taskId, status: { in: ["queued", "running"] } },
  });
  if (active > 0) throw new ValidationError("This task already has a run in progress");

  const policy = opts.policy ?? runPolicyFromEnv();
  const provider = opts.provider ?? policy.defaultProvider;
  if (provider === "mock" && !policy.allowMock) {
    throw new ValidationError("Dry runs with the mock provider are disabled in production");
  }
  if (provider === "anthropic") {
    if (!policy.anthropicConfigured) {
      throw new ValidationError(
        "Claude is not configured: add ANTHROPIC_API_KEY to the server environment, or start a dry run.",
      );
    }
    // Early refusal so nothing is queued while a limit is reached. The worker re-checks
    // atomically (with reservations) right before calling the API.
    const budget = await getBudgetStatus(db, policy.budget);
    if (budget.blocked) {
      const which = budget.day.reached ? "Daily" : "Monthly";
      throw new ValidationError(
        `${which} AI spending limit reached. Paid runs resume when the limit resets or is raised.`,
      );
    }
  }

  const run = await db.$transaction(async (tx) => {
    const r = await tx.agentRun.create({
      data: {
        taskId,
        agentId: task.agentId,
        agentVersion: version.version,
        businessId: task.businessId,
        idempotencyKey,
        provider,
        model: provider === "mock" ? "mock" : version.model,
        events: {
          create: {
            type: "queued",
            message: `Queued by user (agent v${version.version}, ${provider === "mock" ? "dry run on mock provider" : `Claude ${version.model}`})`,
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
export async function retryRun(
  db: PrismaClient,
  queue: RunQueue,
  userId: string,
  runId: string,
  policy?: RunPolicy,
) {
  const run = await db.agentRun.findUnique({ where: { id: runId } });
  if (!run) throw new NotFoundError("Run");
  if (run.status !== "failed" && run.status !== "cancelled") {
    throw new ValidationError("Only failed or cancelled runs can be retried");
  }
  return requestRun(db, queue, userId, run.taskId, {
    provider: run.provider as ProviderName,
    policy,
  });
}
