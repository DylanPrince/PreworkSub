import { afterAll, describe, expect, it } from "vitest";
import { IMPLEMENTED_TEMPLATES } from "@prince/agents";
import { DEFAULT_MODEL_PRICES, PRICES_VERIFIED_ON } from "@prince/ai";
import { createPrismaClient } from "../src/client";
import { seed } from "./seed";

const db = createPrismaClient(process.env.DATABASE_URL);
const sonnet = DEFAULT_MODEL_PRICES.find((p) => p.model === "claude-sonnet-5-5")!;

afterAll(async () => {
  // Leave the shared integration database on the current defaults.
  await db.modelPrice.update({
    where: { model: sonnet.model },
    data: { cacheReadPerMTok: sonnet.cacheReadPerMTok },
  });
  await db.$disconnect();
});

describe("seed", () => {
  it("corrects a price row still holding an earlier seeded default", async () => {
    await db.modelPrice.update({
      where: { model: sonnet.model },
      data: { cacheReadPerMTok: 0.2, source: "old", verifiedAt: new Date("2026-10-06") },
    });
    await seed();
    const row = await db.modelPrice.findUniqueOrThrow({ where: { model: sonnet.model } });
    expect(Number(row.cacheReadPerMTok)).toBe(0.1);
    expect(row.source).toContain(PRICES_VERIFIED_ON);
  });

  it("never overwrites a price someone edited", async () => {
    await db.modelPrice.update({
      where: { model: sonnet.model },
      data: { cacheReadPerMTok: 0.15, source: "Edited by owner" },
    });
    await seed();
    const row = await db.modelPrice.findUniqueOrThrow({ where: { model: sonnet.model } });
    expect(Number(row.cacheReadPerMTok)).toBe(0.15);
    expect(row.source).toBe("Edited by owner");
  });

  it("adds a new built-in agent version when the registry template changes, and only then", async () => {
    const template = IMPLEMENTED_TEMPLATES.find((t) => t.key === "financial-analyst")!;
    const agent = await db.agent.findFirstOrThrow({
      where: { templateKey: template.key, businessId: null },
    });
    const before = await db.agentVersion.findUniqueOrThrow({
      where: { agentId_version: { agentId: agent.id, version: agent.currentVersion } },
    });

    // Re-seeding an up-to-date agent changes nothing.
    await seed();
    expect((await db.agent.findUniqueOrThrow({ where: { id: agent.id } })).currentVersion).toBe(
      agent.currentVersion,
    );

    // Simulate an installation seeded from an older template.
    const { id: _id, createdAt: _c, ...config } = before;
    const stale = agent.currentVersion + 1;
    await db.agentVersion.create({
      data: { ...config, version: stale, maxOutputTokens: 4096, effort: null, changeNote: "old" },
    });
    await db.agent.update({ where: { id: agent.id }, data: { currentVersion: stale } });

    await seed();
    const updated = await db.agent.findUniqueOrThrow({ where: { id: agent.id } });
    expect(updated.currentVersion).toBe(stale + 1);
    const current = await db.agentVersion.findUniqueOrThrow({
      where: { agentId_version: { agentId: agent.id, version: stale + 1 } },
    });
    expect(current).toMatchObject({
      model: before.model,
      maxOutputTokens: template.maxOutputTokens,
      effort: template.effort,
      systemPrompt: template.instructions,
      changeNote: "Updated from the registry template",
    });
  });
});
