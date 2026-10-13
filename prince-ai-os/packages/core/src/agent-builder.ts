import { z } from "zod";
import type { PrismaClient } from "@prince/database";
import { REASONING_EFFORTS, type ProviderName } from "@prince/ai";
import { DIVISIONS, getTemplate, isOutputSchemaKey } from "@prince/agents";
import { requireBusinessRole } from "./access";
import { recordAudit } from "./audit";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import type { RunQueue } from "./run-queue";
import { createTask, runPolicyFromEnv, type RunPolicy } from "./tasks";

/**
 * Agent Builder: owner-managed agents that run on the same executor, contracts, budgets and
 * guardrails as the built-in ones. Built-in (shared) agents are read-only here; they can be
 * duplicated into a business and customised.
 *
 * Agents built here produce structured advisory output only. No agent is given tools that act
 * outside the system (spending, publishing, purchasing, contacting customers); those arrive with
 * the approvals milestone and will always require explicit owner approval.
 */

/** Permissions every agent currently has. Fixed: there are no external-action tools yet. */
export const AGENT_PERMISSIONS = ["read:business"] as const;

export const agentConfigInput = z.object({
  name: z.string().trim().min(3, "Name must be at least 3 characters").max(80),
  description: z.string().trim().min(10, "Describe the agent in at least 10 characters").max(500),
  specialization: z.string().trim().min(3, "Add a short specialization").max(120),
  division: z.enum(DIVISIONS as [string, ...string[]], { message: "Choose a division" }),
  instructions: z
    .string()
    .trim()
    .min(40, "Instructions must be at least 40 characters")
    .max(20_000, "Instructions must be at most 20,000 characters"),
  model: z.string().min(1, "Choose a model"),
  outputSchemaKey: z.string().refine(isOutputSchemaKey, "Choose an output format"),
  maxOutputTokens: z.coerce
    .number()
    .int()
    .min(256, "At least 256 tokens")
    .max(32_000, "At most 32,000 tokens"),
  budgetUsdPerRun: z.coerce.number().min(0.01, "At least $0.01").max(10, "At most $10 per run"),
  timeoutSeconds: z.coerce
    .number()
    .int()
    .min(10, "At least 10 seconds")
    .max(600, "At most 600 seconds"),
  maxAttempts: z.coerce.number().int().min(1, "At least 1").max(5, "At most 5"),
  /** Empty means the model's default effort. */
  effort: z
    .enum(REASONING_EFFORTS, { message: "Choose an effort level" })
    .or(z.literal("").transform(() => null))
    .nullish()
    .transform((v) => v ?? null),
  changeNote: z.string().trim().max(300).default(""),
});
export type AgentConfigInput = z.input<typeof agentConfigInput>;

export const createAgentInput = agentConfigInput.extend({
  businessId: z.string().min(1, "Choose a business"),
});
export type CreateAgentInput = z.input<typeof createAgentInput>;

function invalid(error: z.ZodError): never {
  throw new ValidationError("Check the highlighted fields", z.flattenError(error).fieldErrors);
}

/** Cross-field checks that need the database or server policy. */
async function validateConfig(
  db: PrismaClient,
  input: z.output<typeof agentConfigInput>,
  policy: RunPolicy,
) {
  const price = await db.modelPrice.findUnique({ where: { model: input.model } });
  if (!price || input.model === "mock") {
    throw new ValidationError("Check the highlighted fields", {
      model: ["Choose a model from the price table so cost can be tracked"],
    });
  }
  if (input.budgetUsdPerRun > policy.budget.dailyUsd) {
    throw new ValidationError("Check the highlighted fields", {
      budgetUsdPerRun: [`Cannot exceed the daily limit of $${policy.budget.dailyUsd}`],
    });
  }
}

function versionData(input: z.output<typeof agentConfigInput>) {
  return {
    model: input.model,
    systemPrompt: input.instructions,
    outputSchemaKey: input.outputSchemaKey,
    maxOutputTokens: input.maxOutputTokens,
    effort: input.effort,
    budgetUsdPerRun: input.budgetUsdPerRun,
    timeoutMs: input.timeoutSeconds * 1000,
    maxAttempts: input.maxAttempts,
    allowedTools: [],
    permissions: [...AGENT_PERMISSIONS],
  };
}

/** Loads an agent the user may manage: a custom agent in a business where they are admin+. */
async function requireManageable(db: PrismaClient, userId: string, agentId: string) {
  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent) throw new NotFoundError("Agent");
  if (agent.businessId === null || agent.templateKey !== null) {
    throw new ForbiddenError(
      "Built-in agents are read-only. Duplicate it into a business to customise it.",
    );
  }
  await requireBusinessRole(db, userId, agent.businessId, "admin");
  return agent as typeof agent & { businessId: string };
}

export async function createCustomAgent(
  db: PrismaClient,
  userId: string,
  raw: CreateAgentInput,
  opts: { basedOnTemplateKey?: string | null; policy?: RunPolicy } = {},
) {
  const parsed = createAgentInput.safeParse(raw);
  if (!parsed.success) invalid(parsed.error);
  const input = parsed.data;
  await requireBusinessRole(db, userId, input.businessId, "admin");
  await validateConfig(db, input, opts.policy ?? runPolicyFromEnv());

  return db.$transaction(async (tx) => {
    const agent = await tx.agent.create({
      data: {
        businessId: input.businessId,
        templateKey: null,
        basedOnTemplateKey: opts.basedOnTemplateKey ?? null,
        createdById: userId,
        name: input.name,
        description: input.description,
        specialization: input.specialization,
        division: input.division,
        currentVersion: 1,
        versions: {
          create: {
            version: 1,
            ...versionData(input),
            changeNote: input.changeNote || "Created in Agent Builder",
            createdById: userId,
          },
        },
      },
    });
    await recordAudit(tx, {
      actorType: "user",
      actorId: userId,
      businessId: input.businessId,
      action: "agent.created",
      targetType: "agent",
      targetId: agent.id,
      summary: `Created agent "${agent.name}" (v1, ${input.model})`,
    });
    return agent;
  });
}

/**
 * Saves a new immutable version. `expectedVersion` guards against two editors overwriting each
 * other: the save is refused if someone else saved first.
 */
export async function updateAgentConfig(
  db: PrismaClient,
  userId: string,
  agentId: string,
  raw: AgentConfigInput,
  expectedVersion: number,
  policy: RunPolicy = runPolicyFromEnv(),
) {
  const parsed = agentConfigInput.safeParse(raw);
  if (!parsed.success) invalid(parsed.error);
  const input = parsed.data;
  const agent = await requireManageable(db, userId, agentId);
  await validateConfig(db, input, policy);

  return db.$transaction(async (tx) => {
    const next = expectedVersion + 1;
    const claimed = await tx.agent.updateMany({
      where: { id: agentId, currentVersion: expectedVersion },
      data: {
        name: input.name,
        description: input.description,
        specialization: input.specialization,
        division: input.division,
        currentVersion: next,
      },
    });
    if (claimed.count === 0) {
      throw new ValidationError(
        "This agent was changed by someone else. Reload to see the latest version.",
      );
    }
    await tx.agentVersion.create({
      data: {
        agentId,
        version: next,
        ...versionData(input),
        changeNote: input.changeNote || `Updated in Agent Builder`,
        createdById: userId,
      },
    });
    await recordAudit(tx, {
      actorType: "user",
      actorId: userId,
      businessId: agent.businessId,
      action: "agent.updated",
      targetType: "agent",
      targetId: agentId,
      summary:
        `Saved "${input.name}" v${next}${input.changeNote ? `: ${input.changeNote}` : ""}`.slice(
          0,
          500,
        ),
    });
    return { version: next };
  });
}

/** Restores an earlier configuration as a new version, so history is never rewritten. */
export async function restoreAgentVersion(
  db: PrismaClient,
  userId: string,
  agentId: string,
  fromVersion: number,
) {
  const agent = await requireManageable(db, userId, agentId);
  const source = await db.agentVersion.findUnique({
    where: { agentId_version: { agentId, version: fromVersion } },
  });
  if (!source) throw new NotFoundError("Version");
  return db.$transaction(async (tx) => {
    const next = agent.currentVersion + 1;
    const claimed = await tx.agent.updateMany({
      where: { id: agentId, currentVersion: agent.currentVersion },
      data: { currentVersion: next },
    });
    if (claimed.count === 0)
      throw new ValidationError("This agent was changed by someone else. Reload and try again.");
    const {
      id: _id,
      createdAt: _c,
      version: _v,
      changeNote: _n,
      createdById: _u,
      ...config
    } = source;
    await tx.agentVersion.create({
      data: {
        ...config,
        version: next,
        changeNote: `Restored configuration from v${fromVersion}`,
        createdById: userId,
      },
    });
    await recordAudit(tx, {
      actorType: "user",
      actorId: userId,
      businessId: agent.businessId,
      action: "agent.version_restored",
      targetType: "agent",
      targetId: agentId,
      summary: `Restored "${agent.name}" v${fromVersion} as v${next}`,
    });
    return { version: next };
  });
}

export async function setAgentStatus(
  db: PrismaClient,
  userId: string,
  agentId: string,
  status: "active" | "disabled" | "archived",
) {
  if (!["active", "disabled", "archived"].includes(status))
    throw new ValidationError("Unknown status");
  const agent = await requireManageable(db, userId, agentId);
  if (agent.status === status) return agent;
  return db.$transaction(async (tx) => {
    const updated = await tx.agent.update({ where: { id: agentId }, data: { status } });
    await recordAudit(tx, {
      actorType: "user",
      actorId: userId,
      businessId: agent.businessId,
      action: `agent.${status === "active" ? "enabled" : status}`,
      targetType: "agent",
      targetId: agentId,
      summary: `${agent.name}: ${agent.status} → ${status}`,
    });
    return updated;
  });
}

/** Copies any visible agent's current configuration into a new custom agent in a business. */
export async function duplicateAgent(
  db: PrismaClient,
  userId: string,
  agentId: string,
  businessId: string,
  policy?: RunPolicy,
) {
  const source = await db.agent.findUnique({ where: { id: agentId } });
  if (!source) throw new NotFoundError("Agent");
  if (source.businessId !== null)
    await requireBusinessRole(db, userId, source.businessId, "viewer");
  const version = await db.agentVersion.findUniqueOrThrow({
    where: { agentId_version: { agentId, version: source.currentVersion } },
  });
  return createCustomAgent(
    db,
    userId,
    {
      businessId,
      name: `${source.name} (custom)`.slice(0, 80),
      description: source.description,
      specialization: source.specialization,
      division: source.division,
      instructions: version.systemPrompt,
      model: version.model,
      outputSchemaKey: version.outputSchemaKey,
      maxOutputTokens: version.maxOutputTokens,
      budgetUsdPerRun: Number(version.budgetUsdPerRun),
      timeoutSeconds: Math.round(version.timeoutMs / 1000),
      maxAttempts: version.maxAttempts,
      effort: version.effort,
      changeNote: `Duplicated from ${source.name} v${version.version}`,
    },
    {
      basedOnTemplateKey:
        source.templateKey && getTemplate(source.templateKey)
          ? source.templateKey
          : source.basedOnTemplateKey,
      policy,
    },
  );
}

export const testRunInput = z.object({
  businessId: z.string().min(1, "Choose a business"),
  instructions: z
    .string()
    .trim()
    .min(10, "Describe the test in at least 10 characters")
    .max(20_000),
  provider: z.enum(["anthropic", "mock"]),
  idempotencyKey: z.string().uuid(),
});
export type TestRunInput = z.input<typeof testRunInput>;

/**
 * Runs the agent's current version on sample instructions. Recorded as a "test" task so it stays
 * in history (with cost) but is distinguishable from production work.
 */
export async function startAgentTest(
  db: PrismaClient,
  queue: RunQueue,
  userId: string,
  agentId: string,
  raw: TestRunInput,
  policy?: RunPolicy,
) {
  const parsed = testRunInput.safeParse(raw);
  if (!parsed.success) invalid(parsed.error);
  const input = parsed.data;
  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent) throw new NotFoundError("Agent");
  return createTask(
    db,
    queue,
    userId,
    {
      businessId: input.businessId,
      agentId,
      title: `Test: ${agent.name} v${agent.currentVersion}`.slice(0, 200),
      instructions: input.instructions,
      kind: "test",
      runNow: true,
      idempotencyKey: input.idempotencyKey,
    },
    { provider: input.provider as ProviderName, policy },
  );
}

/** Models offered in the builder: everything in the price table except the mock entry. */
export async function listSelectableModels(db: PrismaClient) {
  const rows = await db.modelPrice.findMany({
    where: { model: { not: "mock" } },
    orderBy: { outputPerMTok: "desc" },
  });
  return rows.map((r) => ({
    id: r.model,
    label: r.displayName,
    inputPerMTok: Number(r.inputPerMTok),
    outputPerMTok: Number(r.outputPerMTok),
  }));
}

/** Businesses where the user may create or manage agents (admin or owner). */
export async function listManageableBusinesses(db: PrismaClient, userId: string) {
  const rows = await db.membership.findMany({
    where: { userId, role: { in: ["owner", "admin"] }, business: { archivedAt: null } },
    select: { business: { select: { id: true, name: true } } },
    orderBy: { business: { name: "asc" } },
  });
  return rows.map((r) => r.business);
}

/** Everything the builder's manage page needs. Only custom agents the user can manage. */
export async function getAgentForBuilder(db: PrismaClient, userId: string, agentId: string) {
  const agent = await requireManageable(db, userId, agentId);
  const [versions, tests, business] = await Promise.all([
    db.agentVersion.findMany({ where: { agentId }, orderBy: { version: "desc" } }),
    db.task.findMany({
      where: { agentId, kind: "test", businessId: agent.businessId },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { runs: { orderBy: { queuedAt: "desc" }, take: 1 } },
    }),
    db.business.findUniqueOrThrow({
      where: { id: agent.businessId },
      select: { id: true, name: true },
    }),
  ]);
  const current = versions.find((v) => v.version === agent.currentVersion);
  if (!current) throw new NotFoundError("Current version");
  return { agent, business, versions, current, tests };
}
