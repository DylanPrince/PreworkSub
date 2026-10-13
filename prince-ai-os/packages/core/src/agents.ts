import type { PrismaClient } from "@prince/database";
import { getContract } from "@prince/agents";
import { accessibleBusinessIds } from "./access";
import { NotFoundError } from "./errors";

/** Agents a user can see: shared agents plus agents scoped to one of their businesses. */
export async function listAgents(
  db: PrismaClient,
  userId: string,
  opts: { includeArchived?: boolean } = {},
) {
  const businessIds = await accessibleBusinessIds(db, userId);
  const agents = await db.agent.findMany({
    where: {
      OR: [{ businessId: null }, { businessId: { in: businessIds } }],
      ...(opts.includeArchived ? {} : { status: { not: "archived" as const } }),
    },
    orderBy: [{ division: "asc" }, { name: "asc" }],
    include: { business: { select: { id: true, name: true } } },
  });
  const stats = await db.agentRun.groupBy({
    by: ["agentId", "status"],
    where: { businessId: { in: businessIds }, agentId: { in: agents.map((a) => a.id) } },
    _count: { _all: true },
    _sum: { costUsd: true },
  });
  const versions = await db.agentVersion.findMany({
    where: { OR: agents.map((a) => ({ agentId: a.id, version: a.currentVersion })) },
    select: { agentId: true, model: true, outputSchemaKey: true },
  });
  return agents.map((agent) => {
    const current = versions.find((v) => v.agentId === agent.id);
    const rows = stats.filter((s) => s.agentId === agent.id);
    const count = (status: string) => rows.find((r) => r.status === status)?._count._all ?? 0;
    return {
      ...agent,
      model: current?.model ?? null,
      outputSchemaKey: current?.outputSchemaKey ?? null,
      executable: !!current && !!getContract(current.outputSchemaKey),
      stats: {
        total: rows.reduce((n, r) => n + r._count._all, 0),
        succeeded: count("succeeded"),
        failed: count("failed"),
        running: count("running") + count("queued"),
        costUsd: rows.reduce((n, r) => n + Number(r._sum.costUsd ?? 0), 0),
      },
    };
  });
}

export async function getAgent(db: PrismaClient, userId: string, agentId: string) {
  const businessIds = await accessibleBusinessIds(db, userId);
  const agent = await db.agent.findFirst({
    where: { id: agentId, OR: [{ businessId: null }, { businessId: { in: businessIds } }] },
    include: {
      business: { select: { id: true, name: true } },
      versions: { orderBy: { version: "desc" } },
    },
  });
  if (!agent) throw new NotFoundError("Agent");
  const runs = await db.agentRun.findMany({
    where: { agentId, businessId: { in: businessIds } },
    orderBy: { queuedAt: "desc" },
    take: 50,
    include: {
      task: { select: { id: true, title: true, kind: true } },
      business: { select: { name: true } },
    },
  });
  return { agent, runs };
}

export async function getCurrentVersion(db: PrismaClient, agentId: string) {
  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: { currentVersion: true },
  });
  if (!agent) throw new NotFoundError("Agent");
  return db.agentVersion.findUniqueOrThrow({
    where: { agentId_version: { agentId, version: agent.currentVersion } },
  });
}
