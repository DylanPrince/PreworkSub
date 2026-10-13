import { z } from "zod";
import type { Prisma, PrismaClient } from "@prince/database";
import {
  ProviderError,
  computeCostUsd,
  estimateMaxCostUsd,
  roughTokenEstimate,
  type AIProvider,
  type ProviderErrorCode,
  type ProviderName,
  type TokenUsage,
} from "@prince/ai";
import { OUTPUT_SCHEMAS, buildSystemPrompt, buildUserPrompt, getContract } from "@prince/agents";
import { recordAudit } from "./audit";
import { reserveBudget, type BudgetLimits } from "./budget";

export interface ExecuteRunDeps {
  db: PrismaClient;
  /** Providers this worker can use. A run executes on the provider recorded when it was queued. */
  providers: Partial<Record<ProviderName, AIProvider>>;
  budget: BudgetLimits;
  /** How often to poll Postgres for a cancellation request while the provider call is in flight. */
  cancelPollMs?: number;
}

export interface ExecuteRunContext {
  attempt: number;
  maxAttempts: number;
}

export type ExecuteRunOutcome =
  | { status: "succeeded" | "failed" | "cancelled" | "skipped" }
  | { status: "retry"; error: ProviderError };

/**
 * Errors where the request may have reached the model before it ended, so tokens may have been
 * billed without usage being reported. These are charged at the reserved worst case and flagged
 * as an estimate, so the budget errs on the side of overcounting.
 */
const POSSIBLY_BILLED_WITHOUT_USAGE: ProviderErrorCode[] = [
  "cancelled",
  "timeout",
  "network",
  "provider_error",
];

/** Token estimate for the budget pre-check, with headroom for tokenizer variance and schema overhead. */
export function estimateInputTokens(system: string, prompt: string, schemaJson: string): number {
  return Math.ceil(roughTokenEstimate(system + prompt + schemaJson) * 1.25) + 500;
}

/**
 * Executes one agent run end to end. Every state transition is written to Postgres before the
 * function returns, so a worker crash leaves an inspectable record. Returns "retry" when the
 * error is transient and attempts remain; the caller (BullMQ) owns the backoff.
 */
export async function executeRun(
  deps: ExecuteRunDeps,
  runId: string,
  ctx: ExecuteRunContext,
): Promise<ExecuteRunOutcome> {
  const { db } = deps;
  const run = await db.agentRun.findUnique({
    where: { id: runId },
    include: { task: true, business: true, agent: true },
  });
  if (!run) return { status: "skipped" };
  if (run.status === "succeeded" || run.status === "failed" || run.status === "cancelled")
    return { status: "skipped" };

  // Totals carried over from earlier attempts of this run (retries keep accumulating).
  const prior = {
    costUsd: Number(run.costUsd ?? 0),
    inputTokens: run.inputTokens ?? 0,
    outputTokens: run.outputTokens ?? 0,
    cacheCreationInputTokens: run.cacheCreationInputTokens ?? 0,
    cacheReadInputTokens: run.cacheReadInputTokens ?? 0,
  };
  let costIsEstimate = run.costIsEstimate;

  /** Adds this attempt's usage and cost to the run totals and releases the budget reservation. */
  const accrue = (usage: TokenUsage | undefined, attemptCostUsd: number | undefined) => ({
    inputTokens: prior.inputTokens + (usage?.inputTokens ?? 0),
    outputTokens: prior.outputTokens + (usage?.outputTokens ?? 0),
    cacheCreationInputTokens:
      prior.cacheCreationInputTokens + (usage?.cacheCreationInputTokens ?? 0),
    cacheReadInputTokens: prior.cacheReadInputTokens + (usage?.cacheReadInputTokens ?? 0),
    costUsd: prior.costUsd + (attemptCostUsd ?? 0),
    costIsEstimate,
    reservedUsd: null,
  });

  const event = (type: string, message: string, data?: Prisma.InputJsonValue) =>
    db.runEvent.create({ data: { runId, type, message, data } });

  const finish = async (
    status: "succeeded" | "failed" | "cancelled",
    data: Prisma.AgentRunUpdateInput,
    message: string,
  ) => {
    const startedAt = run.startedAt ?? new Date();
    await db.$transaction(async (tx) => {
      await tx.agentRun.update({
        where: { id: runId },
        data: {
          reservedUsd: null,
          ...data,
          status,
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
          events: { create: { type: status, message } },
        },
      });
      await tx.task.update({ where: { id: run.taskId }, data: { status } });
      await recordAudit(tx, {
        actorType: "agent",
        actorId: run.agentId,
        businessId: run.businessId,
        action: `run.${status}`,
        targetType: "agent_run",
        targetId: runId,
        summary: `${run.agent.name} run ${status}: ${message}`.slice(0, 500),
      });
    });
    return { status } as const;
  };

  if (run.cancelRequestedAt) return finish("cancelled", {}, "Cancelled before execution started");

  const version = await db.agentVersion.findUnique({
    where: { agentId_version: { agentId: run.agentId, version: run.agentVersion } },
  });
  const contract = version ? getContract(version.outputSchemaKey) : undefined;
  if (!version || !contract) {
    return finish(
      "failed",
      { errorCode: "not_executable", errorMessage: "Agent has no executable configuration" },
      "Agent has no executable configuration",
    );
  }
  if (run.agent.status !== "active") {
    return finish(
      "failed",
      { errorCode: "agent_disabled", errorMessage: `Agent is ${run.agent.status}` },
      `Agent is ${run.agent.status}`,
    );
  }
  const provider = deps.providers[run.provider as ProviderName];
  if (!provider || !provider.isConfigured()) {
    const message =
      run.provider === "anthropic"
        ? "ANTHROPIC_API_KEY is not configured. Add it to the server environment, then retry."
        : `Provider "${run.provider}" is not available on this worker`;
    return finish(
      "failed",
      { errorCode: "not_configured", errorMessage: message },
      "AI provider requires configuration",
    );
  }
  const isMock = provider.name === "mock";

  const system = buildSystemPrompt(version.systemPrompt);
  const prompt = buildUserPrompt(run.business, run.task);
  const schema = OUTPUT_SCHEMAS[contract.key];

  // Budget enforcement uses the price table; models without a price entry are refused.
  const priceModel = isMock ? "mock" : version.model;
  const price = await db.modelPrice.findUnique({ where: { model: priceModel } });
  if (!price) {
    return finish(
      "failed",
      { errorCode: "no_price", errorMessage: `No price configured for model ${priceModel}` },
      "Model has no price entry; refusing to run without cost tracking",
    );
  }
  const priceNums = {
    inputPerMTok: Number(price.inputPerMTok),
    outputPerMTok: Number(price.outputPerMTok),
    cacheWritePerMTok: Number(price.cacheWritePerMTok),
    cacheReadPerMTok: Number(price.cacheReadPerMTok),
  };
  const projected = estimateMaxCostUsd(
    estimateInputTokens(system, prompt, JSON.stringify(z.toJSONSchema(schema))),
    version.maxOutputTokens,
    priceNums,
  );
  const perRunLimit = Number(version.budgetUsdPerRun);
  if (projected > perRunLimit) {
    return finish(
      "failed",
      {
        errorCode: "budget_exceeded",
        errorMessage: `Worst-case cost $${projected.toFixed(4)} exceeds this agent's per-run budget of $${perRunLimit}`,
      },
      "Blocked by per-run budget",
    );
  }

  // Atomically check the global limits and reserve the worst case before calling a paid provider.
  // Mock runs cost nothing, so they neither need nor consume budget.
  const reservation = isMock
    ? await db.agentRun
        .update({
          where: { id: runId },
          data: { status: "running", startedAt: new Date(), attempts: ctx.attempt },
        })
        .then(() => ({ ok: true }) as const)
    : await reserveBudget(db, deps.budget, runId, projected, { attempts: ctx.attempt });
  if (!reservation.ok)
    return finish(
      "failed",
      { errorCode: "budget_exceeded", errorMessage: reservation.reason },
      "Blocked by global budget",
    );
  run.startedAt ??= new Date();
  await db.task.update({ where: { id: run.taskId }, data: { status: "running" } });
  await event(
    "started",
    `Attempt ${ctx.attempt}/${ctx.maxAttempts} on ${isMock ? "mock provider (no charge)" : `Claude ${version.model}`}`,
    { reservedUsd: isMock ? 0 : projected },
  );

  const controller = new AbortController();
  const poll = setInterval(async () => {
    try {
      const r = await db.agentRun.findUnique({
        where: { id: runId },
        select: { cancelRequestedAt: true },
      });
      if (r?.cancelRequestedAt) controller.abort();
    } catch {
      /* transient DB error: keep polling */
    }
  }, deps.cancelPollMs ?? 1000);

  try {
    const result = await provider.completeStructured({
      model: version.model,
      system,
      prompt,
      maxOutputTokens: version.maxOutputTokens,
      outputSchema: schema as never,
      timeoutMs: version.timeoutMs,
      signal: controller.signal,
      mockOutput: () => contract.mockOutput(run.task),
    });
    const problems = contract.evaluate(result.output);
    const attemptCost = computeCostUsd(result.usage, priceNums);
    const common = {
      ...accrue(result.usage, attemptCost),
      model: result.model,
      stopReason: result.stopReason,
      providerLatencyMs: result.latencyMs,
      output: result.output as Prisma.InputJsonValue,
      outputText: result.rawText,
    };
    if (problems.length > 0) {
      return finish(
        "failed",
        { ...common, errorCode: "evaluation_failed", errorMessage: problems.join("; ") },
        `Output failed evaluation: ${problems.join("; ")}`,
      );
    }
    return finish(
      "succeeded",
      { ...common, errorCode: null, errorMessage: null },
      `Completed: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out tokens, $${attemptCost.toFixed(6)}`,
    );
  } catch (error) {
    const err =
      error instanceof ProviderError
        ? error
        : new ProviderError("provider_error", String(error), false);
    let attemptCost: number | undefined;
    if (err.usage) {
      attemptCost = computeCostUsd(err.usage, priceNums);
    } else if (!isMock && POSSIBLY_BILLED_WITHOUT_USAGE.includes(err.code)) {
      attemptCost = projected;
      costIsEstimate = true;
    }
    const totals = accrue(err.usage, attemptCost);
    const fresh = await db.agentRun.findUnique({
      where: { id: runId },
      select: { cancelRequestedAt: true },
    });
    if (err.code === "cancelled" || fresh?.cancelRequestedAt) {
      return finish("cancelled", totals, "Cancelled while running");
    }
    if (err.retryable && ctx.attempt < ctx.maxAttempts) {
      await db.agentRun.update({
        where: { id: runId },
        data: { ...totals, status: "queued", errorCode: err.code, errorMessage: err.message },
      });
      await db.task.update({ where: { id: run.taskId }, data: { status: "queued" } });
      await event(
        "retry_scheduled",
        `Attempt ${ctx.attempt} failed (${err.code}): ${err.message}. Retrying with backoff.`,
        { usage: err.usage ? { ...err.usage } : null, attemptCostUsd: attemptCost ?? 0 },
      );
      return { status: "retry", error: err };
    }
    return finish(
      "failed",
      { ...totals, errorCode: err.code, errorMessage: err.message },
      `${err.code}: ${err.message}`,
    );
  } finally {
    clearInterval(poll);
  }
}
