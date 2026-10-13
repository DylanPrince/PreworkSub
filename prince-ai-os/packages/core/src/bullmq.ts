import { Queue } from "bullmq";
import IORedis from "ioredis";
import { AGENT_RUN_JOB, QUEUES, type AgentRunJobV1 } from "@prince/shared";
import type { RunQueue } from "./run-queue";

export function createRedisConnection(redisUrl: string): IORedis {
  // BullMQ requires maxRetriesPerRequest: null for blocking worker connections.
  return new IORedis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
}

export function createAgentRunQueue(connection: IORedis): Queue<AgentRunJobV1> {
  return new Queue<AgentRunJobV1>(QUEUES.agentRuns, {
    connection,
    defaultJobOptions: {
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
      // Failed jobs stay in BullMQ's failed set (our dead-letter view) as well as in Postgres.
      removeOnFail: { age: 30 * 24 * 3600 },
    },
  });
}

/** Producer used by the web app. Job id = run id, so a run can never be enqueued twice. */
export class BullRunQueue implements RunQueue {
  constructor(private readonly queue: Queue<AgentRunJobV1>) {}

  async enqueue(runId: string, opts: { attempts: number }): Promise<void> {
    await this.queue.add(
      AGENT_RUN_JOB,
      { version: 1, runId },
      { jobId: runId, attempts: opts.attempts },
    );
  }

  async remove(runId: string): Promise<boolean> {
    const job = await this.queue.getJob(runId);
    if (!job) return false;
    const state = await job.getState();
    if (state !== "waiting" && state !== "delayed" && state !== "prioritized") return false;
    try {
      await job.remove();
      return true;
    } catch {
      return false; // picked up by a worker between the state check and removal
    }
  }

  async counts() {
    return this.queue.getJobCounts("waiting", "active", "delayed", "failed", "completed");
  }
}
