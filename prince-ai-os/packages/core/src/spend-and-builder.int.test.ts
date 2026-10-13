import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockProvider, ProviderError } from "@prince/ai";
import { OUTPUT_CONTRACTS } from "@prince/agents";
import { createPrismaClient } from "@prince/database";
import {
  ForbiddenError,
  ValidationError,
  cancelRun,
  createBusiness,
  createCustomAgent,
  createTask,
  duplicateAgent,
  executeRun,
  getAgentForBuilder,
  getAiStatus,
  getBudgetStatus,
  requestRun,
  restoreAgentVersion,
  setAgentStatus,
  startAgentTest,
  updateAgentConfig,
  type CreateAgentInput,
  type RunPolicy,
} from "./index";
import { MemoryQueue, ScriptedProvider } from "./test-helpers";

const db = createPrismaClient(process.env.DATABASE_URL);
const generous = { dailyUsd: 1000, monthlyUsd: 100000 };
const policy = (over: Partial<RunPolicy> = {}): RunPolicy => ({
  defaultProvider: "anthropic",
  anthropicConfigured: true,
  allowMock: true,
  budget: generous,
  ...over,
});

const copyOutput = {
  brief: "b",
  audience: "a",
  variants: [{ channel: "ad", headline: "h", body: "b", callToAction: "c" }],
  complianceNotes: [],
};

let owner: string;
let member: string;
let outsider: string;
let businessId: string;
let copywriterId: string;
let queue: MemoryQueue;

async function makeUser(prefix: string) {
  const u = await db.user.create({
    data: {
      id: crypto.randomUUID(),
      email: `${prefix}-${crypto.randomUUID()}@example.com`,
      name: prefix,
    },
  });
  return u.id;
}

async function liveRun(agentId = copywriterId) {
  const { task } = await createTask(db, queue, owner, {
    businessId,
    agentId,
    title: "Spend test",
    instructions: "Write a short headline for a tent.",
  });
  return requestRun(db, queue, owner, task.id, { provider: "anthropic", policy: policy() });
}

const agentInput = (over: Partial<CreateAgentInput> = {}): CreateAgentInput => ({
  businessId,
  name: "Pricing Reviewer",
  description: "Reviews pricing pages and suggests improvements.",
  specialization: "Pricing review",
  division: "Business Operations",
  instructions:
    "You review pricing for this business. Explain each suggestion and flag missing data clearly.",
  model: "claude-sonnet-5-5",
  outputSchemaKey: "general-report.v1",
  maxOutputTokens: 2048,
  budgetUsdPerRun: 0.2,
  timeoutSeconds: 60,
  maxAttempts: 2,
  ...over,
});

beforeAll(async () => {
  owner = await makeUser("owner");
  member = await makeUser("member");
  outsider = await makeUser("outsider");
  const b = await createBusiness(db, owner, { name: "Spend Co", goals: [] });
  businessId = b.id;
  await db.membership.create({ data: { businessId, userId: member, role: "member" } });
  const cw = await db.agent.findFirstOrThrow({
    where: { templateKey: "copywriting", businessId: null },
  });
  copywriterId = cw.id;
});

beforeEach(() => {
  queue = new MemoryQueue();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("spending limits", () => {
  it("reserves the worst-case cost while a call is in flight and releases it afterwards", async () => {
    const run = await liveRun();
    const provider = new ScriptedProvider({ output: copyOutput, delayMs: 300 });
    const exec = executeRun({ db, providers: { anthropic: provider }, budget: generous }, run.id, {
      attempt: 1,
      maxAttempts: 3,
    });
    await new Promise((r) => setTimeout(r, 150));
    const during = await db.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(during.status).toBe("running");
    expect(Number(during.reservedUsd)).toBeGreaterThan(0);
    const status = await getBudgetStatus(db, generous);
    expect(status.day.reservedUsd).toBeGreaterThanOrEqual(Number(during.reservedUsd));

    expect((await exec).status).toBe("succeeded");
    const after = await db.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(after.reservedUsd).toBeNull();
    expect(Number(after.costUsd)).toBeCloseTo(0.01404, 6);
  });

  it("lets only one of two concurrent runs through when the limit has room for one", async () => {
    // Measure this agent's reservation, then set the limit to fit exactly one more.
    const probe = await liveRun();
    const slow = new ScriptedProvider({ output: copyOutput, delayMs: 400 });
    const probing = executeRun({ db, providers: { anthropic: slow }, budget: generous }, probe.id, {
      attempt: 1,
      maxAttempts: 1,
    });
    await new Promise((r) => setTimeout(r, 150));
    const reserved = Number(
      (await db.agentRun.findUniqueOrThrow({ where: { id: probe.id } })).reservedUsd,
    );
    await probing;

    const base = await getBudgetStatus(db, generous);
    const tight = { dailyUsd: base.day.committedUsd + reserved * 1.5, monthlyUsd: 100000 };
    const [a, b] = [await liveRun(), await liveRun()];
    const provider = new ScriptedProvider({ output: copyOutput, delayMs: 300 });
    const outcomes = await Promise.all(
      [a, b].map((r) =>
        executeRun({ db, providers: { anthropic: provider }, budget: tight }, r.id, {
          attempt: 1,
          maxAttempts: 1,
        }),
      ),
    );
    expect(outcomes.map((o) => o.status).sort()).toEqual(["failed", "succeeded"]);
    expect(provider.calls).toBe(1);
    const blocked = await db.agentRun.findFirstOrThrow({
      where: { id: { in: [a.id, b.id] }, status: "failed" },
    });
    expect(blocked.errorCode).toBe("budget_exceeded");
    expect(blocked.errorMessage).toMatch(/Daily AI budget/);
  });

  it("refuses to queue paid runs once a limit is reached, but still allows free dry runs", async () => {
    const reached = policy({ budget: { dailyUsd: 0, monthlyUsd: 100000 } });
    const { task } = await createTask(db, queue, owner, {
      businessId,
      agentId: copywriterId,
      title: "Blocked",
      instructions: "Write a short headline for a tent.",
    });
    await expect(
      requestRun(db, queue, owner, task.id, { provider: "anthropic", policy: reached }),
    ).rejects.toThrow(/spending limit reached/);
    expect(queue.jobs).toEqual([]);

    const dry = await requestRun(db, queue, owner, task.id, { provider: "mock", policy: reached });
    expect(dry.provider).toBe("mock");
    const outcome = await executeRun(
      {
        db,
        providers: { mock: new MockProvider({ delayMs: 1 }) },
        budget: { dailyUsd: 0, monthlyUsd: 0 },
      },
      dry.id,
      { attempt: 1, maxAttempts: 1 },
    );
    expect(outcome.status).toBe("succeeded");
    expect(await db.agentRun.findUniqueOrThrow({ where: { id: dry.id } })).toMatchObject({
      reservedUsd: null,
      model: "mock",
    });
  });

  it("refuses paid runs when Claude is not configured and dry runs in production", async () => {
    const { task } = await createTask(db, queue, owner, {
      businessId,
      agentId: copywriterId,
      title: "Config",
      instructions: "Write a short headline for a tent.",
    });
    await expect(
      requestRun(db, queue, owner, task.id, {
        provider: "anthropic",
        policy: policy({ anthropicConfigured: false }),
      }),
    ).rejects.toThrow(/not configured/);
    await expect(
      requestRun(db, queue, owner, task.id, {
        provider: "mock",
        policy: policy({ allowMock: false }),
      }),
    ).rejects.toThrow(/disabled in production/);
  });

  it("accumulates usage and cost across retries instead of dropping failed attempts", async () => {
    const run = await liveRun();
    const usage = {
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    };
    const failing = new ScriptedProvider({
      error: new ProviderError("invalid_output", "bad shape", true, usage),
    });
    const first = await executeRun(
      { db, providers: { anthropic: failing }, budget: generous },
      run.id,
      {
        attempt: 1,
        maxAttempts: 2,
      },
    );
    expect(first.status).toBe("retry");
    const mid = await db.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    // 100 × $4/M + 50 × $20/M
    expect(Number(mid.costUsd)).toBeCloseTo(0.0014, 6);
    expect(mid.reservedUsd).toBeNull();

    const ok = new ScriptedProvider({ output: copyOutput, usage });
    await executeRun({ db, providers: { anthropic: ok }, budget: generous }, run.id, {
      attempt: 2,
      maxAttempts: 2,
    });
    const done = await db.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(done.status).toBe("succeeded");
    expect(done.inputTokens).toBe(200);
    expect(Number(done.costUsd)).toBeCloseTo(0.0028, 6);
    expect(done.costIsEstimate).toBe(false);
  });

  it("charges the reserved worst case when a paid call is cancelled without reported usage", async () => {
    const run = await liveRun();
    queue.started.add(run.id);
    const provider = new ScriptedProvider({ output: copyOutput, delayMs: 5_000 });
    const exec = executeRun(
      { db, providers: { anthropic: provider }, budget: generous, cancelPollMs: 50 },
      run.id,
      { attempt: 1, maxAttempts: 3 },
    );
    await new Promise((r) => setTimeout(r, 200));
    await cancelRun(db, queue, owner, run.id);
    expect((await exec).status).toBe("cancelled");
    const saved = await db.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(saved.status).toBe("cancelled");
    expect(saved.costIsEstimate).toBe(true);
    expect(Number(saved.costUsd)).toBeGreaterThan(0);
    expect(saved.reservedUsd).toBeNull();
  });

  it("runs on the provider recorded at queue time, not whatever the worker defaults to", async () => {
    const run = await liveRun();
    const outcome = await executeRun(
      { db, providers: { mock: new MockProvider({ delayMs: 1 }) }, budget: generous },
      run.id,
      { attempt: 1, maxAttempts: 1 },
    );
    expect(outcome.status).toBe("failed");
    expect(await db.agentRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
      errorCode: "not_configured",
      model: "claude-opus-5-5",
    });
  });
});

describe("request limits", () => {
  it("refuses an oversized prompt before any call or reservation", async () => {
    const { task } = await createTask(db, queue, owner, {
      businessId,
      agentId: copywriterId,
      title: "Huge brief",
      instructions: "Write a headline for a tent.",
    });
    // Larger than any form allows, as forwarded results could be: about 100k estimated tokens.
    await db.task.update({ where: { id: task.id }, data: { instructions: "x".repeat(320_000) } });
    const run = await requestRun(db, queue, owner, task.id, {
      provider: "anthropic",
      policy: policy(),
    });
    const provider = new ScriptedProvider({ output: copyOutput });
    const outcome = await executeRun(
      { db, providers: { anthropic: provider }, budget: generous },
      run.id,
      { attempt: 1, maxAttempts: 3 },
    );
    expect(outcome.status).toBe("failed");
    expect(provider.calls).toBe(0);
    const saved = await db.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(saved).toMatchObject({ errorCode: "input_too_large", reservedUsd: null, costUsd: null });
  });

  it("sends the version's effort and records thinking tokens across attempts", async () => {
    const run = await liveRun();
    const usage = {
      inputTokens: 100,
      outputTokens: 400,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      thinkingTokens: 300,
    };
    const flaky = new ScriptedProvider({
      error: new ProviderError("invalid_output", "bad shape", true, usage),
    });
    const deps = (p: ScriptedProvider) => ({ db, providers: { anthropic: p }, budget: generous });
    await executeRun(deps(flaky), run.id, { attempt: 1, maxAttempts: 2 });
    const ok = new ScriptedProvider({ output: copyOutput, usage });
    await executeRun(deps(ok), run.id, { attempt: 2, maxAttempts: 2 });

    // The built-in copywriter's current version comes from the registry template.
    expect(ok.requests[0]).toMatchObject({ effort: "medium", maxOutputTokens: 8192 });
    const done = await db.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(done).toMatchObject({ status: "succeeded", outputTokens: 800, thinkingTokens: 600 });
    // Thinking is billed as output: 200 × $4/M + 800 × $20/M, nothing extra on top.
    expect(Number(done.costUsd)).toBeCloseTo(0.0168, 6);
  });
});

describe("AI status", () => {
  it("reports configuration and limits without exposing secrets", async () => {
    const s = await getAiStatus(db, policy({ budget: { dailyUsd: 0, monthlyUsd: 100000 } }));
    expect(s).toMatchObject({ mode: "live", anthropicConfigured: true, realCallsAvailable: false });
    expect(s.budget.blocked).toBe(true);
    expect(JSON.stringify(s)).not.toMatch(/sk-ant|api[_-]?key/i);
    expect((await getAiStatus(db, policy({ anthropicConfigured: false }))).mode).toBe(
      "not_configured",
    );
    expect((await getAiStatus(db, policy({ defaultProvider: "mock" }))).mode).toBe("mock");
  });
});

describe("Agent Builder", () => {
  it("creates a business-scoped agent with version 1 and an audit record", async () => {
    const agent = await createCustomAgent(db, owner, agentInput(), { policy: policy() });
    expect(agent).toMatchObject({ businessId, templateKey: null, currentVersion: 1 });
    const { current } = await getAgentForBuilder(db, owner, agent.id);
    expect(current).toMatchObject({
      model: "claude-sonnet-5-5",
      outputSchemaKey: "general-report.v1",
      timeoutMs: 60_000,
      effort: null,
      allowedTools: [],
      permissions: ["read:business"],
    });
    expect(
      await db.auditEvent.count({ where: { action: "agent.created", targetId: agent.id } }),
    ).toBe(1);
  });

  it("validates configuration on the server", async () => {
    const fieldsOf = async (input: CreateAgentInput) => {
      try {
        await createCustomAgent(db, owner, input, { policy: policy() });
      } catch (e) {
        expect(e).toBeInstanceOf(ValidationError);
        return Object.keys((e as ValidationError).fieldErrors);
      }
      throw new Error("expected a validation error");
    };
    expect(await fieldsOf(agentInput({ instructions: "too short" }))).toContain("instructions");
    expect(await fieldsOf(agentInput({ outputSchemaKey: "made-up.v1" }))).toContain(
      "outputSchemaKey",
    );
    expect(await fieldsOf(agentInput({ model: "gpt-unknown" }))).toContain("model");
    expect(await fieldsOf(agentInput({ model: "mock" }))).toContain("model");
    expect(await fieldsOf(agentInput({ maxAttempts: 9 }))).toContain("maxAttempts");
    expect(await fieldsOf(agentInput({ effort: "xhigh" as never }))).toContain("effort");
    await expect(
      createCustomAgent(db, owner, agentInput({ budgetUsdPerRun: 6 }), {
        policy: policy({ budget: { dailyUsd: 5, monthlyUsd: 50 } }),
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("only lets business admins create and manage agents", async () => {
    await expect(
      createCustomAgent(db, member, agentInput(), { policy: policy() }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      createCustomAgent(db, outsider, agentInput(), { policy: policy() }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const agent = await createCustomAgent(db, owner, agentInput(), { policy: policy() });
    await expect(getAgentForBuilder(db, outsider, agent.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setAgentStatus(db, member, agent.id, "disabled")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("keeps built-in agents read-only", async () => {
    await expect(
      updateAgentConfig(db, owner, copywriterId, agentInput(), 1, policy()),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("saves edits as new immutable versions and rejects stale saves", async () => {
    const agent = await createCustomAgent(db, owner, agentInput(), { policy: policy() });
    const r = await updateAgentConfig(
      db,
      owner,
      agent.id,
      agentInput({ maxOutputTokens: 1024, changeNote: "Shorter" }),
      1,
      policy(),
    );
    expect(r.version).toBe(2);
    await expect(updateAgentConfig(db, owner, agent.id, agentInput(), 1, policy())).rejects.toThrow(
      /changed by someone else/,
    );

    const restored = await restoreAgentVersion(db, owner, agent.id, 1);
    expect(restored.version).toBe(3);
    const { versions, current } = await getAgentForBuilder(db, owner, agent.id);
    expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(current.maxOutputTokens).toBe(2048);
    expect(current.changeNote).toMatch(/Restored configuration from v1/);
  });

  it("pins each run to the version it was queued with", async () => {
    const agent = await createCustomAgent(db, owner, agentInput(), { policy: policy() });
    const { run } = await startAgentTest(
      db,
      queue,
      owner,
      agent.id,
      {
        businessId,
        instructions: "Review our tent pricing.",
        provider: "mock",
        idempotencyKey: crypto.randomUUID(),
      },
      policy(),
    );
    await updateAgentConfig(
      db,
      owner,
      agent.id,
      agentInput({ model: "claude-haiku-5-5" }),
      1,
      policy(),
    );
    expect(run!.agentVersion).toBe(1);
    await executeRun(
      { db, providers: { mock: new MockProvider({ delayMs: 1 }) }, budget: generous },
      run!.id,
      { attempt: 1, maxAttempts: 1 },
    );
    expect(await db.agentRun.findUniqueOrThrow({ where: { id: run!.id } })).toMatchObject({
      status: "succeeded",
      agentVersion: 1,
    });
  });

  it("test runs are recorded as test tasks and produce contract-valid mock output", async () => {
    const agent = await createCustomAgent(db, owner, agentInput(), { policy: policy() });
    const { task, run } = await startAgentTest(
      db,
      queue,
      owner,
      agent.id,
      {
        businessId,
        instructions: "Review our tent pricing.",
        provider: "mock",
        idempotencyKey: crypto.randomUUID(),
      },
      policy(),
    );
    expect(task.kind).toBe("test");
    expect(run).toMatchObject({ provider: "mock", model: "mock" });
    await executeRun(
      { db, providers: { mock: new MockProvider({ delayMs: 1 }) }, budget: generous },
      run!.id,
      { attempt: 1, maxAttempts: 1 },
    );
    const saved = await db.agentRun.findUniqueOrThrow({ where: { id: run!.id } });
    expect(saved.status).toBe("succeeded");
    expect(OUTPUT_CONTRACTS["general-report.v1"].evaluate(saved.output)).toEqual([]);
    expect(JSON.stringify(saved.output)).toMatch(/MOCK OUTPUT/);
    const { tests } = await getAgentForBuilder(db, owner, agent.id);
    expect(tests.map((t) => t.id)).toContain(task.id);
  });

  it("disabled and archived agents cannot take or run tasks", async () => {
    const agent = await createCustomAgent(db, owner, agentInput(), { policy: policy() });
    const { task } = await createTask(db, queue, owner, {
      businessId,
      agentId: agent.id,
      title: "Before disable",
      instructions: "Review our tent pricing.",
    });
    await setAgentStatus(db, owner, agent.id, "disabled");
    await expect(
      requestRun(db, queue, owner, task.id, { provider: "mock", policy: policy() }),
    ).rejects.toThrow(/is disabled/);
    await setAgentStatus(db, owner, agent.id, "archived");
    await expect(
      createTask(db, queue, owner, {
        businessId,
        agentId: agent.id,
        title: "After archive",
        instructions: "Review our tent pricing.",
      }),
    ).rejects.toThrow(ValidationError);
    expect(
      await db.auditEvent.count({ where: { targetId: agent.id, action: "agent.archived" } }),
    ).toBe(1);
  });

  it("duplicates a built-in agent into an editable custom agent", async () => {
    const copy = await duplicateAgent(db, owner, copywriterId, businessId, policy());
    expect(copy).toMatchObject({
      businessId,
      templateKey: null,
      basedOnTemplateKey: "copywriting",
    });
    const { current } = await getAgentForBuilder(db, owner, copy.id);
    expect(current).toMatchObject({ outputSchemaKey: "copywriting.v1", effort: "medium" });
    await expect(
      duplicateAgent(db, outsider, copywriterId, businessId, policy()),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("custom agents are invisible to other businesses' tasks", async () => {
    const agent = await createCustomAgent(db, owner, agentInput(), { policy: policy() });
    const other = await createBusiness(db, owner, { name: "Other Co", goals: [] });
    await expect(
      createTask(db, queue, owner, {
        businessId: other.id,
        agentId: agent.id,
        title: "Cross business",
        instructions: "Review our tent pricing.",
      }),
    ).rejects.toMatchObject({
      fieldErrors: { agentId: [expect.stringMatching(/not available to the selected business/)] },
    });
  });
});
