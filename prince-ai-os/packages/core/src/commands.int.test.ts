import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockProvider } from "@prince/ai";
import { createPrismaClient } from "@prince/database";
import {
  ForbiddenError,
  commandSignature,
  createBusiness,
  createCommand,
  dispatchWorkstreams,
  executeRun,
  getCommand,
  listCommands,
  matchAgent,
  type RunPolicy,
} from "./index";
import { MemoryQueue } from "./test-helpers";

const db = createPrismaClient(process.env.DATABASE_URL);
const policy = (over: Partial<RunPolicy> = {}): RunPolicy => ({
  defaultProvider: "mock",
  anthropicConfigured: false,
  allowMock: true,
  budget: { dailyUsd: 1000, monthlyUsd: 100000 },
  ...over,
});
const deps = {
  db,
  providers: { mock: new MockProvider({ delayMs: 1 }) },
  budget: { dailyUsd: 1000, monthlyUsd: 100000 },
};

let owner: string;
let viewer: string;
let outsider: string;
let businessId: string;
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

/** Runs every queued job in the memory queue to completion. */
async function drain() {
  while (queue.jobs.length) {
    const job = queue.jobs.shift()!;
    await executeRun(deps, job.runId, { attempt: 1, maxAttempts: job.attempts });
  }
}

async function plannedCommand() {
  const command = await createCommand(
    db,
    queue,
    owner,
    {
      businessId,
      request: "Launch a lightweight camping stove line this quarter.",
      provider: "mock",
      idempotencyKey: crypto.randomUUID(),
    },
    policy(),
  );
  await drain();
  return command;
}

beforeAll(async () => {
  owner = await makeUser("owner");
  viewer = await makeUser("viewer");
  outsider = await makeUser("outsider");
  const b = await createBusiness(db, owner, { name: "Stove Co", goals: ["Launch"] });
  businessId = b.id;
  await db.membership.create({ data: { businessId, userId: viewer, role: "viewer" } });
});

beforeEach(() => {
  queue = new MemoryQueue();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("matchAgent", () => {
  const agents = [
    { id: "1", name: "Market Research Agent" },
    { id: "2", name: "Financial Analyst" },
    { id: "3", name: "Copywriting Agent" },
  ];
  it("matches plan roles to agents by name", () => {
    expect(matchAgent("Market Research Agent", agents)?.id).toBe("1");
    expect(matchAgent("financial analyst", agents)?.id).toBe("2");
    expect(matchAgent("Copywriting", agents)?.id).toBe("3");
    expect(matchAgent("Software Architect", agents)).toBeUndefined();
  });
});

describe("Command Center", () => {
  it("creates a planning task and run, idempotently", async () => {
    const key = crypto.randomUUID();
    const input = {
      businessId,
      request: "Plan a spring promotion for our tents.",
      provider: "mock" as const,
      idempotencyKey: key,
    };
    const a = await createCommand(db, queue, owner, input, policy());
    const b = await createCommand(db, queue, owner, input, policy());
    expect(b.id).toBe(a.id);
    expect(queue.jobs).toHaveLength(1);
    const plan = await db.task.findUniqueOrThrow({
      where: { id: a.planTaskId! },
      include: { agent: true, runs: true },
    });
    expect(plan).toMatchObject({ commandId: a.id, workstream: null });
    expect(plan.agent.templateKey).toBe("executive-coordinator");
    expect(plan.runs).toEqual([expect.objectContaining({ provider: "mock" })]);
    expect(
      await db.auditEvent.count({ where: { action: "command.created", targetId: a.id } }),
    ).toBe(1);
  });

  it("refuses a paid plan when Claude is not configured", async () => {
    await expect(
      createCommand(
        db,
        queue,
        owner,
        {
          businessId,
          request: "Plan a spring promotion for our tents.",
          provider: "anthropic",
          idempotencyKey: crypto.randomUUID(),
        },
        policy(),
      ),
    ).rejects.toThrow(/not configured/);
  });

  it("turns a finished plan into workstreams with agent suggestions and dependencies", async () => {
    const command = await plannedCommand();
    const view = await getCommand(db, owner, command.id);
    expect(view.plan).not.toBeNull();
    const [research, finance] = view.workstreams;
    expect(research).toMatchObject({ title: "Research", ready: true, unmetDependencies: [] });
    expect(view.agents.find((a) => a.id === research!.suggestedAgentId)?.name).toBe(
      "Market Research Agent",
    );
    expect(research!.estimates[research!.suggestedAgentId!]).toBeGreaterThan(0);
    // Dependent workstreams budget for forwarded results, so they estimate higher.
    expect(finance!.estimates[research!.suggestedAgentId!]).toBeGreaterThan(
      research!.estimates[research!.suggestedAgentId!]!,
    );
    expect(finance).toMatchObject({
      title: "Financial check",
      ready: false,
      unmetDependencies: ["Research"],
    });
    // The planner itself is not offered as a dispatch target.
    expect(view.agents.some((a) => a.name === "Executive Coordinator")).toBe(false);
  });

  it("dispatches in dependency order and passes earlier results along", async () => {
    const command = await plannedCommand();
    const view = await getCommand(db, owner, command.id);
    const research = view.workstreams[0]!;
    const finance = view.workstreams[1]!;
    const financeAgent = view.agents.find((a) => a.name === "Financial Analyst")!;

    await expect(
      dispatchWorkstreams(
        db,
        queue,
        owner,
        command.id,
        { provider: "mock", items: [{ workstream: finance.title, agentId: financeAgent.id }] },
        policy(),
      ),
    ).rejects.toThrow(/waiting on "Research"/);

    const first = await dispatchWorkstreams(
      db,
      queue,
      owner,
      command.id,
      {
        provider: "mock",
        items: [{ workstream: research.title, agentId: research.suggestedAgentId! }],
      },
      policy(),
    );
    expect(first.tasks[0]).toMatchObject({ commandId: command.id, workstream: "Research" });
    await expect(
      dispatchWorkstreams(
        db,
        queue,
        owner,
        command.id,
        {
          provider: "mock",
          items: [{ workstream: research.title, agentId: research.suggestedAgentId! }],
        },
        policy(),
      ),
    ).rejects.toThrow(/already been dispatched/);
    await drain();

    const after = await getCommand(db, owner, command.id);
    expect(after.workstreams[1]).toMatchObject({ ready: true, unmetDependencies: [] });
    const second = await dispatchWorkstreams(
      db,
      queue,
      owner,
      command.id,
      { provider: "mock", items: [{ workstream: finance.title, agentId: financeAgent.id }] },
      policy(),
    );
    expect(second.tasks[0]!.instructions).toMatch(/Result of the earlier workstream "Research"/);
    expect(second.tasks[0]!.instructions).toMatch(/MOCK OUTPUT/);
    await drain();

    const list = await listCommands(db, owner);
    expect(list.find((c) => c.id === command.id)).toMatchObject({
      planStatus: "succeeded",
      dispatched: 2,
      succeeded: 2,
      active: 0,
    });
    expect(
      await db.auditEvent.count({ where: { action: "command.dispatched", targetId: command.id } }),
    ).toBe(2);
  });

  it("refuses a paid batch whose combined worst case exceeds the remaining budget", async () => {
    const command = await plannedCommand();
    const view = await getCommand(db, owner, command.id);
    const research = view.workstreams[0]!;
    await expect(
      dispatchWorkstreams(
        db,
        queue,
        owner,
        command.id,
        {
          provider: "anthropic",
          items: [{ workstream: research.title, agentId: research.suggestedAgentId! }],
        },
        policy({ anthropicConfigured: true, budget: { dailyUsd: 0.0001, monthlyUsd: 100000 } }),
      ),
    ).rejects.toThrow(/remains under your spending limits/);
    expect(
      await db.task.count({ where: { commandId: command.id, workstream: { not: null } } }),
    ).toBe(0);
  });

  it("enforces business access: viewers can read but not dispatch, outsiders see nothing", async () => {
    const command = await plannedCommand();
    await expect(getCommand(db, outsider, command.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(commandSignature(db, outsider, command.id)).rejects.toBeInstanceOf(ForbiddenError);
    const view = await getCommand(db, viewer, command.id);
    await expect(
      dispatchWorkstreams(
        db,
        queue,
        viewer,
        command.id,
        {
          provider: "mock",
          items: [{ workstream: "Research", agentId: view.workstreams[0]!.suggestedAgentId! }],
        },
        policy(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listCommands(db, outsider)).some((c) => c.id === command.id)).toBe(false);
  });
});
