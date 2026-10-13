import { z } from "zod";
import type { BacklogStatus, PrismaClient, SaasProject, SaasStage } from "@prince/database";
import { accessibleBusinessIds, requireBusinessRole } from "../access";
import { recordAudit } from "../audit";
import { NotFoundError } from "../errors";
import { loadScoped, longText, optionalUrl, parseInput, shortText } from "./records";

/**
 * SaaS projects: requirements and a backlog per software project. Repository, build and deployment
 * status need a code-host integration (GitHub), which is not connected; the project only stores the
 * repository address. Agents can draft plans from the requirements; they cannot change code.
 */

export const SAAS_STAGES = [
  "idea",
  "specification",
  "building",
  "testing",
  "launched",
  "paused",
] as const satisfies readonly SaasStage[];

export const saasProjectInput = z.object({
  businessId: z.string().min(1, "Choose a business"),
  name: shortText("Name", 120),
  summary: longText(2_000),
  stage: z.enum(SAAS_STAGES).default("idea"),
  repositoryUrl: optionalUrl,
  requirements: longText(20_000),
});
export type SaasProjectInput = z.input<typeof saasProjectInput>;

export const backlogItemInput = z.object({
  title: shortText("Title", 200),
  details: longText(5_000),
  type: z.enum(["feature", "bug", "chore"]).default("feature"),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
});
export type BacklogItemInput = z.input<typeof backlogItemInput>;

async function loadProject(
  db: PrismaClient,
  userId: string,
  id: string,
  minRole: "viewer" | "member",
) {
  return loadScoped(
    db,
    userId,
    await db.saasProject.findUnique({ where: { id } }),
    "Project",
    minRole,
  );
}

export async function createSaasProject(db: PrismaClient, userId: string, raw: SaasProjectInput) {
  const input = parseInput(saasProjectInput, raw);
  await requireBusinessRole(db, userId, input.businessId, "member");
  return db.$transaction(async (tx) => {
    const p = await tx.saasProject.create({ data: { ...input, createdById: userId } });
    await recordAudit(tx, {
      actorType: "user",
      actorId: userId,
      businessId: input.businessId,
      action: "saas.project_created",
      targetType: "saas_project",
      targetId: p.id,
      summary: `Created software project "${p.name}"`,
    });
    return p;
  });
}

export async function updateSaasProject(
  db: PrismaClient,
  userId: string,
  id: string,
  raw: SaasProjectInput,
) {
  const { record } = await loadProject(db, userId, id, "member");
  const input = parseInput(saasProjectInput, { ...raw, businessId: record.businessId });
  return db.$transaction(async (tx) => {
    const p = await tx.saasProject.update({ where: { id }, data: input });
    await recordAudit(tx, {
      actorType: "user",
      actorId: userId,
      businessId: record.businessId,
      action: "saas.project_updated",
      targetType: "saas_project",
      targetId: id,
      summary: `Updated "${p.name}"${record.stage !== p.stage ? ` (${record.stage} → ${p.stage})` : ""}`,
    });
    return p;
  });
}

export async function addBacklogItem(
  db: PrismaClient,
  userId: string,
  projectId: string,
  raw: BacklogItemInput,
) {
  const { record } = await loadProject(db, userId, projectId, "member");
  const input = parseInput(backlogItemInput, raw);
  return db.$transaction(async (tx) => {
    const item = await tx.backlogItem.create({
      data: { ...input, projectId, createdById: userId },
    });
    await recordAudit(tx, {
      actorType: "user",
      actorId: userId,
      businessId: record.businessId,
      action: "saas.backlog_added",
      targetType: "saas_project",
      targetId: projectId,
      summary: `Added ${input.type} "${item.title}" to ${record.name}`,
    });
    return item;
  });
}

export async function setBacklogStatus(
  db: PrismaClient,
  userId: string,
  itemId: string,
  status: BacklogStatus,
) {
  const status_ = z.enum(["todo", "in_progress", "done"]).parse(status);
  const item = await db.backlogItem.findUnique({
    where: { id: itemId },
    include: { project: true },
  });
  if (!item) throw new NotFoundError("Backlog item");
  await requireBusinessRole(db, userId, item.project.businessId, "member");
  if (item.status === status_) return item;
  const updated = await db.backlogItem.update({ where: { id: itemId }, data: { status: status_ } });
  await recordAudit(db, {
    actorType: "user",
    actorId: userId,
    businessId: item.project.businessId,
    action: "saas.backlog_status",
    targetType: "saas_project",
    targetId: item.projectId,
    summary: `"${item.title}": ${item.status.replace("_", " ")} → ${status_.replace("_", " ")}`,
  });
  return updated;
}

export async function listSaasProjects(
  db: PrismaClient,
  userId: string,
  opts: { businessId?: string } = {},
) {
  const all = await accessibleBusinessIds(db, userId);
  const businessIds = opts.businessId ? all.filter((id) => id === opts.businessId) : all;
  const projects = await db.saasProject.findMany({
    where: { businessId: { in: businessIds }, archivedAt: null },
    orderBy: { updatedAt: "desc" },
    include: {
      business: { select: { id: true, name: true } },
      items: { select: { status: true } },
    },
  });
  return projects.map(({ items, ...p }) => ({
    ...p,
    backlog: {
      todo: items.filter((i) => i.status === "todo").length,
      inProgress: items.filter((i) => i.status === "in_progress").length,
      done: items.filter((i) => i.status === "done").length,
    },
  }));
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

export async function getSaasProject(db: PrismaClient, userId: string, id: string) {
  const project = await db.saasProject.findUnique({
    where: { id },
    include: { business: { select: { id: true, name: true } }, items: true },
  });
  const { role } = await loadScoped(db, userId, project, "Project", "viewer");
  const items = [...project!.items].sort(
    (a, b) =>
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
  return { project: { ...project!, items }, canEdit: role !== "viewer" };
}

export function saasContext(
  p: SaasProject & { items?: { title: string; type: string; status: string; priority: string }[] },
) {
  const open = (p.items ?? []).filter((i) => i.status !== "done");
  return [
    `Software project: ${p.name} (stage: ${p.stage})`,
    p.summary && `Summary: ${p.summary}`,
    p.requirements && `Requirements:\n${p.requirements.slice(0, 10_000)}`,
    open.length
      ? `Open backlog:\n${open
          .slice(0, 40)
          .map((i) => `- [${i.priority}] ${i.type}: ${i.title} (${i.status.replace("_", " ")})`)
          .join("\n")}`
      : "Open backlog: empty",
    "Repository, build and deployment status: not available (no code host connected).",
  ]
    .filter(Boolean)
    .join("\n");
}
