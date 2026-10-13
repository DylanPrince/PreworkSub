import "server-only";
import { getAiStatus, runPolicyFromEnv } from "@prince/core";
import type { RunModes } from "@/components/tasks/run-controls";
import { db } from "./server";

/** Which run buttons to offer, derived from server state. Contains no secrets. */
export async function getRunModes(): Promise<RunModes> {
  const s = await getAiStatus(db, runPolicyFromEnv());
  return {
    defaultProvider: s.defaultProvider,
    liveAvailable: s.realCallsAvailable,
    liveBlockedReason: !s.anthropicConfigured
      ? "Claude is not configured on the server yet. Dry runs still work."
      : s.budget.blocked
        ? "A spending limit is reached, so paid runs are paused."
        : undefined,
    mockAvailable: s.mockAvailable,
  };
}
