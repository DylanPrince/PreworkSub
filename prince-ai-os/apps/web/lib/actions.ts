"use server";
import { revalidatePath } from "next/cache";
import { AnthropicProvider } from "@prince/ai";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  cancelRun,
  createBusiness,
  createTask,
  recordAudit,
  requestRun,
  retryRun,
  type CreateBusinessInput,
  type CreateTaskInput,
} from "@prince/core";
import { db, env, getRunQueue } from "./server";
import { requireUser } from "./session";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof ValidationError)
      return { ok: false, error: error.message, fieldErrors: error.fieldErrors };
    if (error instanceof ForbiddenError || error instanceof NotFoundError)
      return { ok: false, error: error.message };
    // Unknown errors: log server-side, return a generic message (no internals to the browser).
    console.error("[action] unexpected error", error);
    return { ok: false, error: "Unexpected server error. Check the server logs." };
  }
}

export async function createBusinessAction(
  input: CreateBusinessInput,
): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  return run(async () => {
    const b = await createBusiness(db, user.id, input);
    revalidatePath("/businesses");
    return { id: b.id };
  });
}

export async function createTaskAction(
  input: CreateTaskInput,
): Promise<ActionResult<{ taskId: string }>> {
  const user = await requireUser();
  return run(async () => {
    const { task } = await createTask(db, getRunQueue(), user.id, input);
    revalidatePath("/tasks");
    return { taskId: task.id };
  });
}

export async function runTaskAction(
  taskId: string,
  idempotencyKey: string,
): Promise<ActionResult<{ runId: string }>> {
  const user = await requireUser();
  return run(async () => {
    const r = await requestRun(db, getRunQueue(), user.id, taskId, { idempotencyKey });
    revalidatePath(`/tasks/${taskId}`);
    return { runId: r.id };
  });
}

export async function cancelRunAction(runId: string): Promise<ActionResult> {
  const user = await requireUser();
  return run(async () => {
    await cancelRun(db, getRunQueue(), user.id, runId);
    revalidatePath("/tasks", "layout");
    return undefined;
  });
}

export async function retryRunAction(runId: string): Promise<ActionResult<{ runId: string }>> {
  const user = await requireUser();
  return run(async () => {
    const r = await retryRun(db, getRunQueue(), user.id, runId);
    revalidatePath("/tasks", "layout");
    return { runId: r.id };
  });
}

/** Verifies the configured Anthropic key with a metadata call (no tokens generated, no charge). */
export async function testAnthropicAction(): Promise<ActionResult<{ message: string }>> {
  const user = await requireUser();
  return run(async () => {
    if (!env.ANTHROPIC_API_KEY)
      return { message: "Not configured: ANTHROPIC_API_KEY is not set on the server." };
    const result = await new AnthropicProvider(env.ANTHROPIC_API_KEY).testConnection(
      env.AI_DEFAULT_MODEL,
    );
    await recordAudit(db, {
      actorType: "user",
      actorId: user.id,
      action: "integration.tested",
      targetType: "integration",
      targetId: "anthropic",
      summary: result.ok ? "Anthropic connection test passed" : "Anthropic connection test failed",
    });
    return {
      message: result.ok
        ? `Connected. ${result.displayName} is available.`
        : `Error: ${result.error}`,
    };
  });
}
