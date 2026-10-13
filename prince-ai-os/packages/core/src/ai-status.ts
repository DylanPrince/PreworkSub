import type { PrismaClient } from "@prince/database";
import { getBudgetStatus, type BudgetStatus } from "./budget";
import type { RunPolicy } from "./tasks";

export type AiMode = "live" | "mock" | "not_configured";

export interface AiStatus {
  /** What a run started with default settings will use. */
  mode: AiMode;
  defaultProvider: RunPolicy["defaultProvider"];
  /** An API key is present in the server environment. The key itself is never exposed. */
  anthropicConfigured: boolean;
  /** A paid Claude run can be started right now (key present and no limit reached). */
  realCallsAvailable: boolean;
  mockAvailable: boolean;
  budget: BudgetStatus;
}

/** Provider and spending state for the status indicator. Contains no secrets. */
export async function getAiStatus(db: PrismaClient, policy: RunPolicy): Promise<AiStatus> {
  const budget = await getBudgetStatus(db, policy.budget);
  const mode: AiMode =
    policy.defaultProvider === "mock"
      ? "mock"
      : policy.anthropicConfigured
        ? "live"
        : "not_configured";
  return {
    mode,
    defaultProvider: policy.defaultProvider,
    anthropicConfigured: policy.anthropicConfigured,
    realCallsAvailable: policy.anthropicConfigured && !budget.blocked,
    mockAvailable: policy.allowMock,
    budget,
  };
}
