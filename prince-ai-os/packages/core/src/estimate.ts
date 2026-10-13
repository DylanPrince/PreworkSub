import { z } from "zod";
import type { Prisma, PrismaClient } from "@prince/database";
import { estimateMaxCostUsd, roughTokenEstimate } from "@prince/ai";
import {
  OUTPUT_SCHEMAS,
  buildSystemPrompt,
  buildUserPrompt,
  isOutputSchemaKey,
} from "@prince/agents";

type Db = PrismaClient | Prisma.TransactionClient;

export interface PriceNumbers {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
}

/** Token estimate for budget pre-checks, with headroom for tokenizer variance and schema overhead. */
export function estimateInputTokens(system: string, prompt: string, schemaJson: string): number {
  return Math.ceil(roughTokenEstimate(system + prompt + schemaJson) * 1.25) + 500;
}

export function schemaJsonFor(outputSchemaKey: string): string {
  return isOutputSchemaKey(outputSchemaKey)
    ? JSON.stringify(z.toJSONSchema(OUTPUT_SCHEMAS[outputSchemaKey]))
    : "";
}

/** Worst-case USD for one attempt: estimated input plus the full output allowance. */
export function worstCaseUsd(
  system: string,
  prompt: string,
  outputSchemaKey: string,
  maxOutputTokens: number,
  price: PriceNumbers,
): number {
  return estimateMaxCostUsd(
    estimateInputTokens(system, prompt, schemaJsonFor(outputSchemaKey)),
    maxOutputTokens,
    price,
  );
}

export function priceNumbers(row: {
  inputPerMTok: Prisma.Decimal | number;
  outputPerMTok: Prisma.Decimal | number;
  cacheWritePerMTok: Prisma.Decimal | number;
  cacheReadPerMTok: Prisma.Decimal | number;
}): PriceNumbers {
  return {
    inputPerMTok: Number(row.inputPerMTok),
    outputPerMTok: Number(row.outputPerMTok),
    cacheWritePerMTok: Number(row.cacheWritePerMTok),
    cacheReadPerMTok: Number(row.cacheReadPerMTok),
  };
}

/**
 * Worst-case cost of running an agent's current version on the given task text for the given
 * business, using the same formula as the worker's pre-flight check. Returns null when the model
 * has no price entry (such a run would be refused anyway).
 */
export async function estimateAgentRunUsd(
  db: Db,
  agentId: string,
  business: { name: string; description: string; businessModel: string; goals: string[] },
  task: { title: string; instructions: string },
): Promise<{ worstCaseUsd: number; perRunBudgetUsd: number; model: string } | null> {
  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: { currentVersion: true },
  });
  if (!agent) return null;
  const version = await db.agentVersion.findUnique({
    where: { agentId_version: { agentId, version: agent.currentVersion } },
  });
  if (!version) return null;
  const price = await db.modelPrice.findUnique({ where: { model: version.model } });
  if (!price) return null;
  return {
    worstCaseUsd: worstCaseUsd(
      buildSystemPrompt(version.systemPrompt),
      buildUserPrompt(business, task),
      version.outputSchemaKey,
      version.maxOutputTokens,
      priceNumbers(price),
    ),
    perRunBudgetUsd: Number(version.budgetUsdPerRun),
    model: version.model,
  };
}
