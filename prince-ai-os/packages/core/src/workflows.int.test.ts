import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockProvider } from "@prince/ai";
import { createPrismaClient } from "@prince/database";
import {
  ForbiddenError,
  RUN_WORKFLOW_STEP_ACTION,
  ValidationError,
  advanceWorkflowRun,
  cancelApproval,
  cancelRun,
  cancelWorkflowRun,
  createBusiness,
  createCustomAgent,
  createWorkflow,
  createWorkflowFromTemplate,
  decideApproval,
  executeRun,
  getWorkflow,
  getWorkflowRun,
  listWorkflows,
  onAgentRunSettled,
  retryRun,
  setWorkflowStatus,
  startWorkflowRun,
  updateWorkflow,
  validateStepGraph,
  type RunPolicy,
  type WorkflowStep,
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
let admin: string;
let member: string;
let viewer: string;
let outsider: string;
let businessId: string;
let otherBusinessId: string;
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

/** Runs queued jobs the way the worker does, including the workflow hook after each run ends. */
async function drain() {
  while (queue.jobs.length) {
    const job = queue.jobs.shift()!;
    await executeRun(deps, job.runId, { attempt: 1, maxAttempts: job.attempts });
    await onAgentRunSettled(db, queue, job.runId, policy());
  }
}

async function builtIn(templateKey: string) {
  const agent = await db.agent.findFirstOrThrow({ where: { templateKey, businessId: null } });
  return agent.id;
}

function step(over: Partial<WorkflowStep> & { title: string }): WorkflowStep {
  return {
    agentId: "unused",
    instructions: "Do the work described here: {{input}}",
    dependsOn: [],
    requiresApproval: false,
    ...over,
  };
}

const start = (
  workflowId: string,
  userId = owner,
  over: { provider?: "mock" | "anthropic" } = {},
) =>
  startWorkflowRun(
    db,
    queue,
    userId,
    workflowId,
    {
      input: "A refillable bamboo toothbrush subscription",
      provider: over.provider ?? "mock",
      idempotencyKey: crypto.randomUUID(),
    },
    policy(),
  );

async function templateWorkflow() {
  return createWorkflowFromTemplate(db, owner, businessId, "product-idea-validation");
}

beforeAll(async () => {
  owner = await makeUser("wf-owner");
  admin = await makeUser("wf-admin");
  member = await makeUser("wf-member");
  viewer = await makeUser("wf-viewer");
  outsider = await makeUser("wf-outsider");
  businessId = (await createBusiness(db, owner, { name: "Workflow Co", goals: [] })).id;
  otherBusinessId = (await createBusiness(db, outsider, { name: "Elsewhere Ltd", goals: [] })).id;
  await db.membership.createMany({
    data: [
      { businessId, userId: admin, role: "admin" },
      { businessId, userId: member, role: "member" },
      { businessId, userId: viewer, role: "viewer" },
    ],
  });
});

beforeEach(() => {
  queue = new MemoryQueue();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("step graph validation", () => {
  it("accepts a graph without cycles", () => {
    expect(() =>
      validateStepGraph([
        step({ title: "A" }),
        step({ title: "B", dependsOn: ["A"] }),
        step({ title: "C", dependsOn: ["A", "B"] }),
      ]),
    ).not.toThrow();
  });

  it("rejects duplicate names, unknown and self dependencies, and loops", () => {
    expect(() => validateStepGraph([step({ title: "A" }), step({ title: "a" })])).toThrow(
      /different name/,
    );
    expect(() => validateStepGraph([step({ title: "A", dependsOn: ["Z"] })])).toThrow(/not a step/);
    expect(() => validateStepGraph([step({ title: "A", dependsOn: ["A"] })])).toThrow(
      /depend on itself/,
    );
    expect(() =>
      validateStepGraph([
        step({ title: "A", dependsOn: ["C"] }),
        step({ title: "B", dependsOn: ["A"] }),
        step({ title: "C", dependsOn: ["B"] }),
        step({ title: "D" }),
      ]),
    ).toThrow(/loop: A, B, C/);
  });
});

describe("editing workflows", () => {
  it("is limited to business admins and owners, and audited", async () => {
    const agentId = await builtIn("market-research");
    const input = {
      businessId,
      name: "Weekly research",
      steps: [step({ title: "Research", agentId })],
    };
    await expect(createWorkflow(db, member, input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createWorkflow(db, viewer, input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createWorkflow(db, outsider, input)).rejects.toBeInstanceOf(ForbiddenError);
    const wf = await createWorkflow(db, admin, input);
    expect(wf).toMatchObject({ status: "active", version: 1, createdById: admin });
    expect(
      await db.auditEvent.count({ where: { action: "workflow.created", targetId: wf.id } }),
    ).toBe(1);
  });

  it("refuses agents that belong to another business", async () => {
    const foreign = await createCustomAgent(
      db,
      outsider,
      {
        businessId: otherBusinessId,
        name: "Foreign researcher",
        description: "Belongs to another business entirely.",
        specialization: "Research",
        division: "Business Operations",
        instructions:
          "You research markets for this business. Explain each finding and flag missing data clearly.",
        model: "claude-sonnet-5-5",
        outputSchemaKey: "general-report.v1",
        maxOutputTokens: 2048,
        budgetUsdPerRun: 0.2,
        timeoutSeconds: 60,
        maxAttempts: 1,
      },
      { policy: policy() },
    );
    await expect(
      createWorkflow(db, owner, {
        businessId,
        name: "Borrowed agent",
        steps: [step({ title: "Research", agentId: foreign.id })],
      }),
    ).rejects.toThrow(/not available to this business/);
  });

  it("reports which step is invalid", async () => {
    const agentId = await builtIn("market-research");
    const err = await createWorkflow(db, owner, {
      businessId,
      name: "Short steps",
      steps: [
        step({ title: "Research", agentId }),
        step({ title: "Next", agentId, instructions: "x" }),
      ],
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).fieldErrors?.steps?.[0]).toMatch(/^Step 2: /);
  });

  it("saves new versions with optimistic concurrency; runs keep the steps they started with", async () => {
    const wf = await templateWorkflow();
    const run = await start(wf.id);
    const view = await getWorkflow(db, owner, wf.id);
    const shorter = view.steps.slice(0, 1).map(({ title, agentId, instructions }) => ({
      title,
      agentId,
      instructions,
    }));
    await expect(
      updateWorkflow(db, member, wf.id, { businessId, name: "Renamed", steps: shorter }, 1),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(
      await updateWorkflow(db, owner, wf.id, { businessId, name: "Renamed", steps: shorter }, 1),
    ).toEqual({ version: 2 });
    await expect(
      updateWorkflow(db, admin, wf.id, { businessId, name: "Stale", steps: shorter }, 1),
    ).rejects.toThrow(/changed by someone else/);
    const stored = await db.workflowRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(stored.workflowVersion).toBe(1);
    expect(stored.definition as unknown[]).toHaveLength(3);
  });

  it("builds templates from the built-in agents", async () => {
    const wf = await templateWorkflow();
    const view = await getWorkflow(db, viewer, wf.id);
    expect(view.steps.map((s) => [s.title, s.agentName, s.requiresApproval])).toEqual([
      ["Market research", "Market Research Agent", false],
      ["Unit economics", "Financial Analyst", false],
      ["Launch copy", "Copywriting Agent", true],
    ]);
    expect(view.steps.every((s) => s.agentAvailable)).toBe(true);
    expect(view.totalWorstCaseUsd).toBeGreaterThan(0);
    expect(view).toMatchObject({ canEdit: false, canRun: false });
    await expect(getWorkflow(db, outsider, wf.id)).rejects.toBeInstanceOf(ForbiddenError);
    const listed = await listWorkflows(db, viewer);
    expect(listed.find((w) => w.id === wf.id)).toMatchObject({ stepCount: 3 });
    expect(await listWorkflows(db, outsider)).not.toContainEqual(
      expect.objectContaining({ id: wf.id }),
    );
  });
});

describe("running workflows", () => {
  it("runs steps in dependency order, forwards results and waits for approval", async () => {
    const wf = await templateWorkflow();
    await expect(start(wf.id, viewer)).rejects.toBeInstanceOf(ForbiddenError);
    const run = await start(wf.id, member);
    expect(run.status).toBe("running");
    expect(queue.jobs).toHaveLength(1);
    let tasks = await db.task.findMany({ where: { workflowRunId: run.id } });
    expect(tasks.map((t) => t.workflowStep)).toEqual(["Market research"]);
    expect(tasks[0]!.instructions).toContain("A refillable bamboo toothbrush subscription");

    await drain();
    tasks = await db.task.findMany({
      where: { workflowRunId: run.id },
      orderBy: { createdAt: "asc" },
    });
    expect(tasks.map((t) => [t.workflowStep, t.status])).toEqual([
      ["Market research", "succeeded"],
      ["Unit economics", "succeeded"],
    ]);
    expect(tasks[1]!.instructions).toContain('Result of the earlier step "Market research"');

    const waiting = await getWorkflowRun(db, viewer, run.id);
    expect(waiting.run.status).toBe("waiting_approval");
    const launch = waiting.steps.find((s) => s.title === "Launch copy")!;
    expect(launch).toMatchObject({ task: null, approval: { status: "pending" } });
    const approval = await db.approvalRequest.findUniqueOrThrow({
      where: { id: launch.approval!.id },
    });
    expect(approval).toMatchObject({
      action: RUN_WORKFLOW_STEP_ACTION,
      requestedById: member,
      targetType: "workflow_run",
      targetId: run.id,
    });
    expect(Number(approval.estimatedCostUsd)).toBe(0);
    // Advancing again (another event) never duplicates the request.
    await advanceWorkflowRun(db, queue, run.id, policy());
    expect(
      await db.approvalRequest.count({ where: { targetType: "workflow_run", targetId: run.id } }),
    ).toBe(1);

    await expect(
      decideApproval(db, queue, member, approval.id, { decision: "approve" }, policy()),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const decided = await decideApproval(
      db,
      queue,
      admin,
      approval.id,
      { decision: "approve" },
      policy(),
    );
    expect(decided.status).toBe("executed");
    const launchTask = await db.task.findFirstOrThrow({
      where: { workflowRunId: run.id, workflowStep: "Launch copy" },
    });
    expect(launchTask.createdById).toBe(admin);
    expect(launchTask.instructions).toContain('Result of the earlier step "Unit economics"');
    expect(launchTask.instructions).toContain("The owner approved this step");
    await drain();

    const done = await getWorkflowRun(db, owner, run.id);
    expect(done.run.status).toBe("succeeded");
    expect(done.run.finishedAt).not.toBeNull();
    expect(done.steps.every((s) => s.latestRun?.status === "succeeded")).toBe(true);
    expect(done.steps.every((s) => s.latestRun?.provider === "mock")).toBe(true);
    const actions = (
      await db.auditEvent.findMany({
        where: { targetId: run.id },
        orderBy: { createdAt: "asc" },
        select: { action: true },
      })
    ).map((a) => a.action);
    expect(actions).toEqual([
      "workflow.run_started",
      "workflow.step_started",
      "workflow.step_started",
      "workflow.step_started",
      "workflow.run_succeeded",
    ]);
  });

  it("is idempotent per start request", async () => {
    const wf = await templateWorkflow();
    const key = crypto.randomUUID();
    const input = { input: "Same request twice", provider: "mock" as const, idempotencyKey: key };
    const [a, b] = await Promise.all([
      startWorkflowRun(db, queue, owner, wf.id, input, policy()),
      startWorkflowRun(db, queue, owner, wf.id, input, policy()),
    ]);
    expect(a.id).toBe(b.id);
    expect(await db.workflowRun.count({ where: { clientKey: key } })).toBe(1);
    expect(await db.task.count({ where: { workflowRunId: a.id } })).toBe(1);
    await expect(startWorkflowRun(db, queue, admin, wf.id, input, policy())).rejects.toThrow(
      /Idempotency key already used/,
    );
  });

  it("starts each step once when advanced concurrently", async () => {
    const agentId = await builtIn("market-research");
    const wf = await createWorkflow(db, owner, {
      businessId,
      name: "Fan out",
      steps: [
        step({ title: "One", agentId }),
        step({ title: "Two", agentId }),
        step({ title: "Three", agentId, dependsOn: ["One", "Two"] }),
      ],
    });
    const run = await start(wf.id);
    await Promise.all(
      Array.from({ length: 6 }, () => advanceWorkflowRun(db, queue, run.id, policy())),
    );
    expect(await db.task.count({ where: { workflowRunId: run.id } })).toBe(2);
    expect(queue.jobs).toHaveLength(2);
    const jobs = queue.jobs.splice(0);
    for (const j of jobs) await executeRun(deps, j.runId, { attempt: 1, maxAttempts: 1 });
    await Promise.all(jobs.map((j) => onAgentRunSettled(db, queue, j.runId, policy())));
    expect(await db.task.count({ where: { workflowRunId: run.id, workflowStep: "Three" } })).toBe(
      1,
    );
    await drain();
    expect((await db.workflowRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe(
      "succeeded",
    );
  });

  it("fails the run when an approval is rejected, withdrawn or expires", async () => {
    const wf = await createWorkflowFromTemplate(db, owner, businessId, "campaign-copy");
    for (const outcome of ["rejected", "withdrawn", "expired"] as const) {
      const run = await start(wf.id, member);
      await drain();
      const approval = await db.approvalRequest.findFirstOrThrow({
        where: { targetType: "workflow_run", targetId: run.id },
      });
      if (outcome === "rejected")
        await decideApproval(
          db,
          queue,
          owner,
          approval.id,
          { decision: "reject", note: "Not this quarter" },
          policy(),
        );
      else if (outcome === "withdrawn") await cancelApproval(db, member, approval.id);
      else
        await db.approvalRequest.update({
          where: { id: approval.id },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });
      const view = await getWorkflowRun(db, owner, run.id);
      expect(view.run.status).toBe("failed");
      expect(view.run.error).toMatch(
        {
          rejected: /"Campaign copy" was rejected: Not this quarter/,
          withdrawn: /was withdrawn/,
          expired: /expired/,
        }[outcome],
      );
      expect(await db.task.count({ where: { workflowRunId: run.id } })).toBe(1);
    }
  });

  it("fails when a step fails, and resumes when that step is retried", async () => {
    const wf = await templateWorkflow();
    const run = await start(wf.id);
    const job = queue.jobs[0];
    await cancelRun(db, queue, owner, job!.runId);
    expect(queue.jobs).toHaveLength(0);
    await onAgentRunSettled(db, queue, job!.runId, policy());
    let view = await getWorkflowRun(db, owner, run.id);
    expect(view.run.status).toBe("failed");
    expect(view.run.error).toMatch(/"Market research" cancelled/);
    expect(view.steps[1]).toMatchObject({ task: null, waitingOn: ["Market research"] });

    const retried = await retryRun(db, queue, owner, job!.runId, policy());
    await onAgentRunSettled(db, queue, retried.id, policy());
    expect((await db.workflowRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe(
      "running",
    );
    await drain();
    view = await getWorkflowRun(db, owner, run.id);
    expect(view.run.status).toBe("waiting_approval");
    expect(view.run.error).toBeNull();
  });

  it("cancels queued steps and pending approvals, and stops advancing", async () => {
    const wf = await templateWorkflow();
    const run = await start(wf.id);
    await expect(cancelWorkflowRun(db, queue, viewer, run.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await cancelWorkflowRun(db, queue, member, run.id);
    expect(queue.jobs).toHaveLength(0);
    const view = await getWorkflowRun(db, owner, run.id);
    expect(view.run.status).toBe("cancelled");
    expect(view.canCancel).toBe(false);
    expect(view.steps[0]!.latestRun?.status).toBe("cancelled");
    await advanceWorkflowRun(db, queue, run.id, policy());
    expect(await db.task.count({ where: { workflowRunId: run.id } })).toBe(1);
    await expect(cancelWorkflowRun(db, queue, owner, run.id)).rejects.toThrow(/already/);

    // A run waiting for approval: the request is withdrawn with the run.
    const second = await start(wf.id);
    await drain();
    await cancelWorkflowRun(db, queue, owner, second.id);
    const approval = await db.approvalRequest.findFirstOrThrow({
      where: { targetType: "workflow_run", targetId: second.id },
    });
    expect(approval.status).toBe("cancelled");
    await expect(
      decideApproval(db, queue, owner, approval.id, { decision: "approve" }, policy()),
    ).rejects.toThrow(/already cancelled/);
  });

  it("refuses disabled workflows, paid runs without a key, and paid runs over the limit", async () => {
    const wf = await templateWorkflow();
    await expect(setWorkflowStatus(db, member, wf.id, "disabled")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await setWorkflowStatus(db, owner, wf.id, "disabled");
    await expect(start(wf.id)).rejects.toThrow(/disabled; enable it/);
    await setWorkflowStatus(db, owner, wf.id, "active");

    await expect(start(wf.id, owner, { provider: "anthropic" })).rejects.toThrow(
      /Claude is not configured/,
    );
    const input = {
      input: "A paid run",
      provider: "anthropic" as const,
      idempotencyKey: crypto.randomUUID(),
    };
    await expect(
      startWorkflowRun(
        db,
        queue,
        owner,
        wf.id,
        input,
        policy({ anthropicConfigured: true, budget: { dailyUsd: 0.0001, monthlyUsd: 100000 } }),
      ),
    ).rejects.toThrow(/could cost up to \$[\d.]+, but only \$[\d.]+ remains/);
    await expect(
      startWorkflowRun(
        db,
        queue,
        owner,
        wf.id,
        { ...input, provider: "mock" },
        policy({ allowMock: false }),
      ),
    ).rejects.toThrow(/disabled in production/);
    expect(queue.jobs).toHaveLength(0);

    const paid = await startWorkflowRun(
      db,
      queue,
      owner,
      wf.id,
      { ...input, idempotencyKey: crypto.randomUUID() },
      policy({ anthropicConfigured: true }),
    );
    expect(Number(paid.estimatedMaxUsd)).toBeGreaterThan(0);
    const first = await db.agentRun.findFirstOrThrow({
      where: { task: { workflowRunId: paid.id } },
    });
    expect(first.provider).toBe("anthropic");
    await cancelWorkflowRun(db, queue, owner, paid.id);
  });
});
