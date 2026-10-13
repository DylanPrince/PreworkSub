/**
 * Idempotent seed: model price table and the executable agent registry entries.
 * Creates no businesses, tasks, runs, or financial data — the app never ships with fake performance.
 */
import path from "node:path";
import { config } from "dotenv";
import { IMPLEMENTED_TEMPLATES } from "@prince/agents";
import {
  DEFAULT_MODEL_PRICES,
  PRICES_SOURCE_URL,
  PRICES_VERIFIED_ON,
  SUPERSEDED_DEFAULT_PRICES,
  type ModelPriceInput,
} from "@prince/ai";
import { createPrismaClient } from "../src/client";

config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });

type PriceValues = Pick<
  ModelPriceInput,
  "inputPerMTok" | "outputPerMTok" | "cacheWritePerMTok" | "cacheReadPerMTok"
>;

const samePrices = (a: PriceValues, b: PriceValues) =>
  a.inputPerMTok === b.inputPerMTok &&
  a.outputPerMTok === b.outputPerMTok &&
  a.cacheWritePerMTok === b.cacheWritePerMTok &&
  a.cacheReadPerMTok === b.cacheReadPerMTok;

/** Template-managed fields of a built-in agent version. */
function templateVersion(t: (typeof IMPLEMENTED_TEMPLATES)[number]) {
  return {
    systemPrompt: t.instructions,
    allowedTools: t.allowedTools,
    permissions: t.permissions,
    outputSchemaKey: t.outputSchemaKey,
    maxOutputTokens: t.maxOutputTokens,
    effort: t.effort,
    budgetUsdPerRun: t.budgetUsdPerRun,
    timeoutMs: t.timeoutMs,
    maxAttempts: t.maxAttempts,
  };
}

export async function seed(databaseUrl = process.env.DATABASE_URL) {
  const db = createPrismaClient(databaseUrl);
  const defaultModel = process.env.AI_DEFAULT_MODEL || "claude-opus-5-5";
  try {
    for (const p of DEFAULT_MODEL_PRICES) {
      const values: PriceValues = {
        inputPerMTok: p.inputPerMTok,
        outputPerMTok: p.outputPerMTok,
        cacheWritePerMTok: p.cacheWritePerMTok,
        cacheReadPerMTok: p.cacheReadPerMTok,
      };
      const data = {
        displayName: p.displayName,
        ...values,
        source:
          p.model === "mock"
            ? "Internal mock provider"
            : `Anthropic pricing page (${PRICES_SOURCE_URL}), verified ${PRICES_VERIFIED_ON}`,
        verifiedAt: new Date(`${PRICES_VERIFIED_ON}T00:00:00Z`),
      };
      const existing = await db.modelPrice.findUnique({ where: { model: p.model } });
      if (!existing) {
        await db.modelPrice.create({ data: { model: p.model, ...data } });
        continue;
      }
      // Prices someone edited are never overwritten. A row still holding an earlier seeded
      // default (or the current one) is brought up to date along with its verification date.
      const stored: PriceValues = {
        inputPerMTok: Number(existing.inputPerMTok),
        outputPerMTok: Number(existing.outputPerMTok),
        cacheWritePerMTok: Number(existing.cacheWritePerMTok),
        cacheReadPerMTok: Number(existing.cacheReadPerMTok),
      };
      const seededDefault =
        samePrices(stored, values) ||
        SUPERSEDED_DEFAULT_PRICES.some((old) => old.model === p.model && samePrices(stored, old));
      if (seededDefault && p.model !== "mock") {
        await db.modelPrice.update({ where: { model: p.model }, data });
      }
    }

    for (const t of IMPLEMENTED_TEMPLATES) {
      const existing = await db.agent.findFirst({
        where: { templateKey: t.key, businessId: null },
        include: { versions: { orderBy: { version: "desc" }, take: 1 } },
      });
      if (!existing) {
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
                ...templateVersion(t),
                changeNote: "Initial version from registry template",
              },
            },
          },
        });
        continue;
      }
      // Built-in agents are read-only in the app, so their versions only ever come from the
      // registry. When the template changes, add a new version (keeping the chosen model);
      // earlier runs stay pinned to the version they used.
      const latest = existing.versions[0];
      const wanted = templateVersion(t);
      const differs =
        !latest ||
        latest.systemPrompt !== wanted.systemPrompt ||
        latest.outputSchemaKey !== wanted.outputSchemaKey ||
        latest.maxOutputTokens !== wanted.maxOutputTokens ||
        (latest.effort ?? null) !== (wanted.effort ?? null) ||
        Number(latest.budgetUsdPerRun) !== wanted.budgetUsdPerRun ||
        latest.timeoutMs !== wanted.timeoutMs ||
        latest.maxAttempts !== wanted.maxAttempts ||
        latest.allowedTools.join() !== wanted.allowedTools.join() ||
        latest.permissions.join() !== wanted.permissions.join();
      if (!differs) continue;
      const version = (latest?.version ?? 0) + 1;
      await db.$transaction([
        db.agentVersion.create({
          data: {
            agentId: existing.id,
            version,
            model: latest?.model ?? defaultModel,
            ...wanted,
            changeNote: "Updated from the registry template",
          },
        }),
        db.agent.update({
          where: { id: existing.id },
          data: {
            currentVersion: version,
            name: t.name,
            description: t.description,
            specialization: t.specialization,
            division: t.division,
          },
        }),
      ]);
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
