import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

const globalForPrisma = globalThis as unknown as { __princePrisma?: PrismaClient };

export function createPrismaClient(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/** Process-wide singleton (survives Next.js dev hot reloads). */
export function getPrisma(): PrismaClient {
  globalForPrisma.__princePrisma ??= createPrismaClient();
  return globalForPrisma.__princePrisma;
}
