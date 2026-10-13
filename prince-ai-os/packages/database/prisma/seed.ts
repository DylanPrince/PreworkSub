/**
 * Idempotent seed: model price table and the executable agent registry entries.
 * Creates no businesses, tasks, runs, or financial data — the app never ships with fake performance.
 */
import path from "node:path";
import { config } from "dotenv";
import { IMPLEMENTED_TEMPLATES } from "@prince/agents";
import { DEFAULT_MODEL_PRICES } from "@prince/ai";
import { createPrismaClient } from "../src/client";

config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });

export async function seed(databaseUrl = process.env.DATABASE_URL) {
  const db = createPrismaClient(databaseUrl);
  const defaultModel = process.env.AI_DEFAULT_MODEL || "claude-opus-5-5";
  try {
    for (const p of DEFAULT_MODEL_PRICES) {
      const data = {
        displayName: p.displayName,
        inputPerMTok: p.inputPerMTok,
        outputPerMTok: p.outputPerMTok,
        cacheWritePerMTok: p.cacheWritePerMTok,
        cacheReadPerMTok: p.cacheReadPerMTok,
        source:
          p.model === "mock"
            ? "Internal mock provider"
            : "Anthropic pricing (cached 2026-10-06); verify before accounting use",
        verifiedAt: new Date("2026-10-06T00:00:00Z"),
      };
      // Only insert: prices edited by the owner must not be overwritten by re-seeding.
      await db.modelPrice.upsert({
        where: { model: p.model },
        create: { model: p.model, ...data },
        update: {},
      });
    }

    for (const t of IMPLEMENTED_TEMPLATES) {
      const existing = await db.agent.findFirst({
        where: { templateKey: t.key, businessId: null },
      });
      if (existing) continue;
      await db.agent.create({
        data: {
          templateKey: t.key,
          name: t.name,
          description: t.description,
          specialization: t.specialization,
          division: t.division,
          currentVersion: 1,
          versions: {
            create: {
              version: 1,
              model: defaultModel,
              systemPrompt: t.instructions,
              allowedTools: t.allowedTools,
              permissions: t.permissions,
              outputSchemaKey: t.outputSchemaKey,
              maxOutputTokens: t.maxOutputTokens,
              budgetUsdPerRun: t.budgetUsdPerRun,
              timeoutMs: t.timeoutMs,
              maxAttempts: t.maxAttempts,
              changeNote: "Initial version from registry template",
            },
          },
        },
      });
    }
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  seed()
    .then(() => console.log("Seed complete"))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
