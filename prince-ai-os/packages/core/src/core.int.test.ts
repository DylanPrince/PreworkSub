import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AnthropicProvider, MockProvider, ProviderError, type AIProvider } from "@prince/ai";
import { createPrismaClient } from "@prince/database";
import {
  ForbiddenError,
  ValidationError,
  cancelRun,
  createBusiness,
  createTask,
  executeRun,
  getBusiness,
  getOverview,
  getTask,
  listTasks,
  requestRun,
  retryRun,
  type RunQueue,
} from "./index";

const db = createPrismaClient(process.env.DATABASE_URL);

class MemoryQueue implements RunQueue {
  jobs: { runId: string; attempts: number }[] = [];
  started = new Set<string>();
  async enqueue(runId: string, opts: { attempts: number }) {
    this.jobs.push({ runId, ...opts });
  }
  async remove(runId: string) {
    if (this.started.has(runId)) return false;
    const before = this.jobs.length;
    this.jobs = this.jobs.filter((j) => j.runId !== runId);
    return this.jobs.length < before;
  }
}

/** Provider that returns a fixed output or throws a fixed error, for exercising executor branches. */
class ScriptedProvider implements AIProvider {
  readonly name = "anthropic" as const;
  calls = 0;
  constructor(private readonly behaviour: { output?: unknown; error?: ProviderError }) {}
  isConfigured() {
    return true;
  }
  async completeStructured<T>() {
    this.calls += 1;
    if (this.behaviour.error) throw this.behaviour.error;
    return {
      provider: this.name,
      model: "claude-opus-5-5",
      output: this.behaviour.output as T,
      rawText: JSON.stringify(this.behaviour.output),
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 200,
      },
      stopReason: "end_turn",
      latencyMs: 42,
    };
  }
}

// Generous limits so spend accumulated by earlier suite runs never trips unrelated tests.
const budget = { dailyUsd: 1000, monthlyUsd: 100000 };
let owner: string;
let outsider: string;
let businessId: string;
let agentIds: Record<string, string>;
let queue: MemoryQueue;

async function makeUser(email: string) {
  const u = await db.user.create({
    data: { id: crypto.randomUUID(), email, name: email.split("@")[0]! },
  });
  return u.id;
}

async function newTask(agentKey: string, instructions = "Please analyse the camping gear market.") {
  const { task } = await createTask(db, queue, owner, {
    businessId,
    agentId: agentIds[agentKey]!,
    title: `Task for ${agentKey}`,
    instructions,
  });
  return task;
}

beforeAll(async () => {
  owner = await makeUser(`owner-${Date.now()}@example.com`);
  outsider = await makeUser(`outsider-${Date.now()}@example.com`);
  const b = await createBusiness(db, owner, {
    name: "Acme Outdoor",
    businessModel: "DTC",
    goals: ["Grow"],
  });
  businessId = b.id;
  const agents = await db.agent.findMany({ where: { businessId: null } });
  agentIds = Object.fromEntries(agents.map((a) => [a.templateKey!, a.id]));
});

beforeEach(() => {
  queue = new MemoryQueue();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("business workspaces", () => {
  it("creates an owner membership and an audit record", async () => {
    const b = await getBusiness(db, owner, businessId);
    expect(b.memberships).toEqual([expect.objectContaining({ userId: owner, role: "owner" })]);
    expect(
      await db.auditEvent.count({ where: { action: "business.created", targetId: businessId } }),
    ).toBe(1);
  });

  it("isolates businesses between users", async () => {
    await expect(getBusiness(db, outsider, businessId)).rejects.toBeInstanceOf(ForbiddenError);
    const task = await newTask("market-research");
    await expect(getTask(db, outsider, task.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await listTasks(db, outsider)).toEqual([]);
    await expect(requestRun(db, queue, outsider, task.id)).rejects.toBeInstanceOf(ForbiddenError);
    const overview = await getOverview(db, outsider);
    expect(overview.counts.businesses).toBe(0);
  });

  it("validates input on the server", async () => {
    await expect(createBusiness(db, owner, { name: "x" })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createTask(db, queue, owner, {
        businessId,
        agentId: agentIds["copywriting"]!,
        title: "ab",
        instructions: "short",
      }),
    ).rejects.toMatchObject({
      fieldErrors: { title: expect.any(Array), instructions: expect.any(Array) },
    });
  });
});

describe("run lifecycle", () => {
  it("is idempotent per key and enqueues exactly once", async () => {
    const task = await newTask("copywriting");
    const key = crypto.randomUUID();
    const a = await requestRun(db, queue, owner, task.id, { idempotencyKey: key });
    const b = await requestRun(db, queue, owner, task.id, { idempotencyKey: key });
    expect(b.id).toBe(a.id);
    expect(queue.jobs).toEqual([{ runId: a.id, attempts: 3 }]);
    await expect(requestRun(db, queue, owner, task.id)).rejects.toThrow(
      /already has a run in progress/,
    );
  });

  it("executes on the mock provider and persists output, usage, cost and events", async () => {
    const task = await newTask("market-research");
    const run = await requestRun(db, queue, owner, task.id);
    const outcome = await executeRun(
      { db, provider: new MockProvider({ delayMs: 5 }), budget },
      run.id,
      { attempt: 1, maxAttempts: 3 },
    );
    expect(outcome.status).toBe("succeeded");
    const saved = await db.agentRun.findUniqueOrThrow({
      where: { id: run.id },
      include: { events: true, task: true },
    });
    expect(saved).toMatchObject({
      status: "succeeded",
      provider: "mock",
      model: "mock",
      attempts: 1,
    });
    expect(saved.inputTokens).toBeGreaterThan(0);
    expect(Number(saved.costUsd)).toBe(0);
    expect(saved.task.status).toBe("succeeded");
    expect(saved.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["queued", "started", "succeeded"]),
    );
    expect(
      await db.auditEvent.count({ where: { action: "run.succeeded", targetId: run.id } }),
    ).toBe(1);
  });

  it("computes cost from provider usage and the price table", async () => {
    const task = await newTask("copywriting");
    const run = await requestRun(db, queue, owner, task.id);
    const provider = new ScriptedProvider({
      output: {
        brief: "b",
        audience: "a",
        variants: [{ channel: "ad", headline: "h", body: "b", callToAction: "c" }],
        complianceNotes: [],
      },
    });
    await executeRun({ db, provider, budget }, run.id, { attempt: 1, maxAttempts: 3 });
    const saved = await db.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    // 1000 in × $4/M + 500 out × $20/M + 200 cache read × $0.20/M
    expect(Number(saved.costUsd)).toBeCloseTo(0.004 + 0.01 + 0.00004, 6);
    expect(saved.providerLatencyMs).toBe(42);
  });

  it("fails clearly when the Claude API key is not configured", async () => {
    const task = await newTask("market-research");
    const run = await requestRun(db, queue, owner, task.id);
    await executeRun({ db, provider: new AnthropicProvider(undefined), budget }, run.id, {
      attempt: 1,
      maxAttempts: 3,
    });
    expect(await db.agentRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
      status: "failed",
      errorCode: "not_configured",
    });
  });

  it("hands transient errors back for retry, then fails on the final attempt", async () => {
    const task = await newTask("market-research");
    const run = await requestRun(db, queue, owner, task.id);
    const provider = new ScriptedProvider({
      error: new ProviderError("rate_limited", "slow down", true),
    });
    const first = await executeRun({ db, provider, budget }, run.id, {
      attempt: 1,
      maxAttempts: 2,
    });
    expect(first.status).toBe("retry");
    expect((await db.agentRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("queued");
    const last = await executeRun({ db, provider, budget }, run.id, { attempt: 2, maxAttempts: 2 });
    expect(last.status).toBe("failed");
    expect(await db.agentRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
      status: "failed",
      errorCode: "rate_limited",
      attempts: 2,
    });
    // A new run is created on manual retry so every attempt stays in history.
    const again = await retryRun(db, queue, owner, run.id);
    expect(again.id).not.toBe(run.id);
  });

  it("rejects outputs that fail the agent's evaluation criteria", async () => {
    const task = await newTask("executive-coordinator");
    const run = await requestRun(db, queue, owner, task.id);
    const provider = new ScriptedProvider({
      output: {
        objective: "o",
        summary: "s",
        workstreams: [
          {
            title: "A",
            owner: "x",
            description: "d",
            dependsOn: ["A"],
            requiresHumanApproval: false,
          },
        ],
        risks: [],
        decisionsForOwner: [],
      },
    });
    await executeRun({ db, provider, budget }, run.id, { attempt: 1, maxAttempts: 3 });
    expect(await db.agentRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
      status: "failed",
      errorCode: "evaluation_failed",
    });
  });

  it("enforces the per-run and global budgets before calling the provider", async () => {
    const provider = new ScriptedProvider({ output: {} });
    const t1 = await newTask("market-research");
    const r1 = await requestRun(db, queue, owner, t1.id);
    await executeRun({ db, provider, budget: { dailyUsd: 0, monthlyUsd: 100000 } }, r1.id, {
      attempt: 1,
      maxAttempts: 3,
    });
    expect(await db.agentRun.findUniqueOrThrow({ where: { id: r1.id } })).toMatchObject({
      status: "failed",
      errorCode: "budget_exceeded",
    });

    const t2 = await newTask("market-research");
    const r2 = await requestRun(db, queue, owner, t2.id);
    await db.agentVersion.updateMany({
      where: { agentId: agentIds["market-research"]! },
      data: { budgetUsdPerRun: 0.0001 },
    });
    try {
      await executeRun({ db, provider, budget }, r2.id, { attempt: 1, maxAttempts: 3 });
    } finally {
      await db.agentVersion.updateMany({
        where: { agentId: agentIds["market-research"]! },
        data: { budgetUsdPerRun: 0.4 },
      });
    }
    expect(await db.agentRun.findUniqueOrThrow({ where: { id: r2.id } })).toMatchObject({
      status: "failed",
      errorCode: "budget_exceeded",
    });
    expect(provider.calls).toBe(0);
  });

  it("cancels a queued run without executing it", async () => {
    const task = await newTask("copywriting");
    const run = await requestRun(db, queue, owner, task.id);
    await cancelRun(db, queue, owner, run.id);
    expect(queue.jobs).toEqual([]);
    expect(await db.agentRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
      status: "cancelled",
    });
    const outcome = await executeRun({ db, provider: new MockProvider(), budget }, run.id, {
      attempt: 1,
      maxAttempts: 3,
    });
    expect(outcome.status).toBe("skipped");
  });

  it("aborts an in-flight run when cancellation is requested", async () => {
    const task = await newTask("copywriting");
    const run = await requestRun(db, queue, owner, task.id);
    queue.started.add(run.id);
    const exec = executeRun(
      { db, provider: new MockProvider({ delayMs: 5_000 }), budget, cancelPollMs: 50 },
      run.id,
      { attempt: 1, maxAttempts: 3 },
    );
    await new Promise((r) => setTimeout(r, 200));
    await cancelRun(db, queue, owner, run.id);
    expect((await exec).status).toBe("cancelled");
    expect(await db.agentRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
      status: "cancelled",
    });
  });
});
