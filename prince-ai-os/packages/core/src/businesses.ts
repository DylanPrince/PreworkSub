import { z } from "zod";
import type { PrismaClient } from "@prince/database";
import { recordAudit } from "./audit";
import { requireBusinessRole } from "./access";
import { ValidationError } from "./errors";

export const createBusinessInput = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  description: z.string().trim().max(2000).default(""),
  businessModel: z.string().trim().max(200).default(""),
  goals: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
});
export type CreateBusinessInput = z.input<typeof createBusinessInput>;

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "business"
  );
}

export async function createBusiness(db: PrismaClient, userId: string, raw: CreateBusinessInput) {
  const parsed = createBusinessInput.safeParse(raw);
  if (!parsed.success)
    throw new ValidationError("Invalid business", z.flattenError(parsed.error).fieldErrors);
  const input = parsed.data;
  const base = slugify(input.name);
  const existing = await db.business.count({ where: { slug: { startsWith: base } } });
  const slug =
    existing === 0 ? base : `${base}-${existing + 1}-${Math.random().toString(36).slice(2, 6)}`;

  return db.$transaction(async (tx) => {
    const business = await tx.business.create({
      data: { ...input, slug, memberships: { create: { userId, role: "owner" } } },
    });
    await recordAudit(tx, {
      actorType: "user",
      actorId: userId,
      businessId: business.id,
      action: "business.created",
      targetType: "business",
      targetId: business.id,
      summary: `Created business "${business.name}"`,
    });
    return business;
  });
}

export async function listBusinesses(db: PrismaClient, userId: string) {
  return db.business.findMany({
    where: { archivedAt: null, memberships: { some: { userId } } },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { tasks: true, runs: true } } },
  });
}

export async function getBusiness(db: PrismaClient, userId: string, businessId: string) {
  await requireBusinessRole(db, userId, businessId, "viewer");
  return db.business.findUniqueOrThrow({
    where: { id: businessId },
    include: {
      memberships: { include: { user: { select: { id: true, name: true, email: true } } } },
      _count: { select: { tasks: true, runs: true } },
    },
  });
}
