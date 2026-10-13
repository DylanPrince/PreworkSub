/**
 * Prince AI OS background worker: a long-running process (not a Claude Code subagent) that consumes
 * agent-run jobs from BullMQ and executes them against the configured AI provider.
 */
import { Worker, UnrecoverableError, type Job } from "bullmq";
import { createProvider } from "@prince/ai";
import { createRedisConnection, executeRun } from "@prince/core";
import { getPrisma } from "@prince/database";
import { QUEUES, getServerEnv, type AgentRunJobV1 } from "@prince/shared";
import { log } from "./log";

const env = getServerEnv();
const db = getPrisma();
const provider = createProvider(env.AI_PROVIDER, env.ANTHROPIC_API_KEY);
const connection = createRedisConnection(env.REDIS_URL);

async function processJob(job: Job<AgentRunJobV1>) {
  if (job.data?.version !== 1 || typeof job.data.runId !== "string") {
    throw new UnrecoverableError("Unsupported job payload");
  }
  const attempt = job.attemptsMade + 1;
  const maxAttempts = job.opts.attempts ?? 1;
  log.info("job.start", { jobId: job.id, runId: job.data.runId, attempt, maxAttempts });
  const outcome = await executeRun(
    {
      db,
      provider,
      budget: { dailyUsd: env.AI_DAILY_BUDGET_USD, monthlyUsd: env.AI_MONTHLY_BUDGET_USD },
    },
    job.data.runId,
    { attempt, maxAttempts },
  );
  if (outcome.status === "retry") {
    // Throwing hands control back to BullMQ, which applies exponential backoff.
    throw outcome.error;
  }
  log.info("job.done", { jobId: job.id, runId: job.data.runId, status: outcome.status });
  return outcome.status;
}

const worker = new Worker<AgentRunJobV1>(QUEUES.agentRuns, processJob, {
  connection,
  concurrency: 4,
  // Bound how long a stalled (crashed) job stays locked before another worker picks it up.
  lockDuration: 60_000,
});

worker.on("failed", (job, err) =>
  log.warn("job.failed", { jobId: job?.id, attemptsMade: job?.attemptsMade, error: err.message }),
);
worker.on("error", (err) => log.error("worker.error", { error: err.message }));
worker.on("ready", () =>
  log.info("worker.ready", {
    queue: QUEUES.agentRuns,
    provider: provider.name,
    configured: provider.isConfigured(),
  }),
);

async function shutdown(signal: string) {
  log.info("worker.shutdown", { signal });
  await worker.close();
  await connection.quit();
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
