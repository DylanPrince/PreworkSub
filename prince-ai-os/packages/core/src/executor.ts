import type { Prisma, PrismaClient } from "@prince/database";
import {
  ProviderError,
  computeCostUsd,
  estimateMaxCostUsd,
  roughTokenEstimate,
  type AIProvider,
  type TokenUsage,
} from "@prince/ai";
import {
  OUTPUT_SCHEMAS,
  buildSystemPrompt,
  buildUserPrompt,
  getImplementedTemplate,
  isOutputSchemaKey,
} from "@prince/agents";
import { recordAudit } from "./audit";
import { checkGlobalBudget, type BudgetLimits } from "./budget";

export interface ExecuteRunDeps {
  db: PrismaClient;
  provider: AIProvider;
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

function usageData(u: TokenUsage | undefined) {
  if (!u) return {};
  return {
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cacheCreationInputTokens: u.cacheCreationInputTokens,
    cacheReadInputTokens: u.cacheReadInputTokens,
  };
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
  const { db, provider } = deps;
  const run = await db.agentRun.findUnique({
    where: { id: runId },
    include: { task: true, business: true, agent: true },
  });
  if (!run) return { status: "skipped" };
  if (run.status === "succeeded" || run.status === "failed" || run.status === "cancelled")
    return { status: "skipped" };

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

  const template = getImplementedTemplate(run.agent.templateKey);
  const version = await db.agentVersion.findUnique({
    where: { agentId_version: { agentId: run.agentId, version: run.agentVersion } },
  });
  if (!template || !version || !isOutputSchemaKey(version.outputSchemaKey)) {
    return finish(
      "failed",
      { errorCode: "not_executable", errorMessage: "Agent has no executable configuration" },
      "Agent has no executable configuration",
    );
  }
  if (run.agent.status !== "active") {
    return finish(
      "failed",
      { errorCode: "agent_disabled", errorMessage: "Agent is disabled" },
      "Agent is disabled",
    );
  }
  if (!provider.isConfigured()) {
    return finish(
      "failed",
      {
        errorCode: "not_configured",
        errorMessage:
          "ANTHROPIC_API_KEY is not configured. Add it to the server environment, then retry.",
      },
      "AI provider requires configuration",
    );
  }

  const system = buildSystemPrompt(version.systemPrompt);
  const prompt = buildUserPrompt(run.business, run.task);

  // Budget enforcement uses the price table; models without a price entry are refused.
  const priceModel = provider.name === "mock" ? "mock" : version.model;
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
    roughTokenEstimate(system + prompt),
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
  const budget = await checkGlobalBudget(db, deps.budget, projected);
  if (!budget.ok)
    return finish(
      "failed",
      { errorCode: "budget_exceeded", errorMessage: budget.reason },
      "Blocked by global budget",
    );

  const startedAt = run.startedAt ?? new Date();
  await db.agentRun.update({
    where: { id: runId },
    data: { status: "running", startedAt, attempts: ctx.attempt },
  });
  run.startedAt = startedAt;
  await db.task.update({ where: { id: run.taskId }, data: { status: "running" } });
  await event(
    "started",
    `Attempt ${ctx.attempt}/${ctx.maxAttempts} on ${provider.name} (${provider.name === "mock" ? "mock" : version.model})`,
    {
      projectedMaxCostUsd: projected,
    },
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
    const schema = OUTPUT_SCHEMAS[version.outputSchemaKey];
    const result = await provider.completeStructured({
      model: version.model,
      system,
      prompt,
      maxOutputTokens: version.maxOutputTokens,
      outputSchema: schema as never,
      timeoutMs: version.timeoutMs,
      signal: controller.signal,
      mockOutput: () => template.mockOutput(run.task),
    });
    const problems = template.evaluate(result.output);
    const costUsd = computeCostUsd(result.usage, priceNums);
    await db.agentRun.update({
      where: { id: runId },
      data: { providerLatencyMs: result.latencyMs },
    });
    if (problems.length > 0) {
      return finish(
        "failed",
        {
          ...usageData(result.usage),
          costUsd,
          model: result.model,
          stopReason: result.stopReason,
          output: result.output as Prisma.InputJsonValue,
          outputText: result.rawText,
          errorCode: "evaluation_failed",
          errorMessage: problems.join("; "),
        },
        `Output failed evaluation: ${problems.join("; ")}`,
      );
    }
    return finish(
      "succeeded",
      {
        ...usageData(result.usage),
        costUsd,
        model: result.model,
        stopReason: result.stopReason,
        output: result.output as Prisma.InputJsonValue,
        outputText: result.rawText,
        errorCode: null,
        errorMessage: null,
      },
      `Completed: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out tokens, $${costUsd.toFixed(6)}`,
    );
  } catch (error) {
    const err =
      error instanceof ProviderError
        ? error
        : new ProviderError("provider_error", String(error), false);
    const usage = err.usage;
    const costUsd = usage ? computeCostUsd(usage, priceNums) : undefined;
    const fresh = await db.agentRun.findUnique({
      where: { id: runId },
      select: { cancelRequestedAt: true },
    });
    if (err.code === "cancelled" || fresh?.cancelRequestedAt) {
      return finish("cancelled", { ...usageData(usage), costUsd }, "Cancelled while running");
    }
    if (err.retryable && ctx.attempt < ctx.maxAttempts) {
      await db.agentRun.update({
        where: { id: runId },
        data: { status: "queued", errorCode: err.code, errorMessage: err.message },
      });
      await db.task.update({ where: { id: run.taskId }, data: { status: "queued" } });
      await event(
        "retry_scheduled",
        `Attempt ${ctx.attempt} failed (${err.code}): ${err.message}. Retrying with backoff.`,
        {
          usage: usage ? { ...usage } : null,
          costUsd: costUsd ?? null,
        },
      );
      return { status: "retry", error: err };
    }
    return finish(
      "failed",
      { ...usageData(usage), costUsd, errorCode: err.code, errorMessage: err.message },
      `${err.code}: ${err.message}`,
    );
  } finally {
    clearInterval(poll);
  }
}
