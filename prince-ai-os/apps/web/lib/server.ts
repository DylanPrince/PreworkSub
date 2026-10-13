import "server-only";
import { BullRunQueue, createAgentRunQueue, createRedisConnection } from "@prince/core";
import { getPrisma } from "@prince/database";
import { getServerEnv } from "@prince/shared";

export const env = getServerEnv();
export const db = getPrisma();

const g = globalThis as unknown as { __princeQueue?: BullRunQueue };

/** Lazily-created BullMQ producer (one per server process). */
export function getRunQueue(): BullRunQueue {
  g.__princeQueue ??= new BullRunQueue(createAgentRunQueue(createRedisConnection(env.REDIS_URL)));
  return g.__princeQueue;
}
