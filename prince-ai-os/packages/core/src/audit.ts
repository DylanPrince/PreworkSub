import type { ActorType, Prisma, PrismaClient } from "@prince/database";

type Db = PrismaClient | Prisma.TransactionClient;

export interface AuditInput {
  actorType: ActorType;
  actorId?: string | null;
  businessId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  summary: string;
  metadata?: Prisma.InputJsonValue;
}

/** Append-only audit trail. Never put secrets or raw credentials in metadata. */
export async function recordAudit(db: Db, input: AuditInput): Promise<void> {
  await db.auditEvent.create({ data: { ...input, metadata: input.metadata ?? undefined } });
}
