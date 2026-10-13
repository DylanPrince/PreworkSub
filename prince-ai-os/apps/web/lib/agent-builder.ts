import "server-only";
import { DIVISIONS, OUTPUT_CONTRACTS } from "@prince/agents";
import { listSelectableModels } from "@prince/core";
import type { ContractOption } from "@/components/agent-builder/agent-form";
import { db } from "./server";

/** Options shared by the create and edit forms. */
export async function getBuilderOptions() {
  const models = await listSelectableModels(db);
  const contracts: ContractOption[] = Object.values(OUTPUT_CONTRACTS).map((c) => ({
    key: c.key,
    label: c.label,
    description: c.description,
  }));
  return { models, contracts, divisions: [...DIVISIONS] };
}
