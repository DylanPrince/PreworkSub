import type { MembershipRole, PrismaClient } from "@prince/database";
import { ForbiddenError } from "./errors";

const RANK: Record<MembershipRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

/** Business ids the user can read. Every query for business data is filtered by this list. */
export async function accessibleBusinessIds(db: PrismaClient, userId: string): Promise<string[]> {
  const rows = await db.membership.findMany({
    where: { userId, business: { archivedAt: null } },
    select: { businessId: true },
  });
  return rows.map((r) => r.businessId);
}

export async function requireBusinessRole(
  db: PrismaClient,
  userId: string,
  businessId: string,
  minRole: MembershipRole,
): Promise<MembershipRole> {
  const m = await db.membership.findUnique({
    where: { businessId_userId: { businessId, userId } },
    select: { role: true },
  });
  // Same error whether the business does not exist or the user lacks access: no existence oracle.
  if (!m || RANK[m.role] < RANK[minRole]) throw new ForbiddenError();
  return m.role;
}
