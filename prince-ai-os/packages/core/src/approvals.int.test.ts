import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockProvider } from "@prince/ai";
import { createPrismaClient } from "@prince/database";
import {
  DISPATCH_WORKSTREAM_ACTION,
  ForbiddenError,
  approvalFingerprint,
  cancelApproval,
  createBusiness,
  createCommand,
  decideApproval,
  dispatchWorkstreams,
  executeRun,
  getApproval,
  getCommand,
  getOverview,
  listApprovals,
  requestApproval,
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
const FLAGGED = "Launch copy";

let owner: string;
let member: string;
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

async function drain() {
  while (queue.jobs.length) {
    const job = queue.jobs.shift()!;
    await executeRun(deps, job.runId, { attempt: 1, maxAttempts: job.attempts });
  }
}

/** A planned command whose unflagged workstreams have succeeded, so the flagged one is next. */
async function commandReadyForFlagged() {
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
  for (const title of ["Research", "Financial check"]) {
    const view = await getCommand(db, owner, command.id);
    const w = view.workstreams.find((x) => x.title === title)!;
    await dispatchWorkstreams(
      db,
      queue,
      owner,
      command.id,
      { provider: "mock", items: [{ workstream: title, agentId: w.suggestedAgentId! }] },
      policy(),
    );
    await drain();
  }
  const view = await getCommand(db, owner, command.id);
  const flagged = view.workstreams.find((w) => w.title === FLAGGED)!;
  return { command, flagged, agents: view.agents };
}

async function requestFlagged(
  userId = owner,
  provider: "mock" | "anthropic" = "mock",
  p = policy(),
) {
  const ctx = await commandReadyForFlagged();
  const result = await dispatchWorkstreams(
    db,
    queue,
    userId,
    ctx.command.id,
    { provider, items: [{ workstream: FLAGGED, agentId: ctx.flagged.suggestedAgentId! }] },
    p,
  );
  return { ...ctx, result, approval: result.approvals[0]! };
}

beforeAll(async () => {
  owner = await makeUser("owner");
  member = await makeUser("member");
  viewer = await makeUser("viewer");
  outsider = await makeUser("outsider");
  const b = await createBusiness(db, owner, { name: "Approval Co", goals: [] });
  businessId = b.id;
  await db.membership.createMany({
    data: [
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

describe("flagged workstreams", () => {
  it("become a pending approval request instead of a task", async () => {
    const { command, flagged, result, approval } = await requestFlagged(member);
    expect(flagged).toMatchObject({ requiresHumanApproval: true, ready: true });
    expect(result.tasks).toHaveLength(0);
    expect(queue.jobs).toHaveLength(0);
    expect(approval).toMatchObject({
      status: "pending",
      action: DISPATCH_WORKSTREAM_ACTION,
      category: "owner_flagged",
      requestedByType: "user",
      requestedById: member,
      targetType: "command",
      targetId: command.id,
    });
    expect(await db.task.count({ where: { commandId: command.id, workstream: FLAGGED } })).toBe(0);

    const view = await getCommand(db, owner, command.id);
    expect(view.workstreams.find((w) => w.title === FLAGGED)).toMatchObject({
      awaitingApproval: true,
      ready: false,
      approval: { id: approval.id, status: "pending" },
    });
    await expect(
      dispatchWorkstreams(
        db,
        queue,
        owner,
        command.id,
        { provider: "mock", items: [{ workstream: FLAGGED, agentId: flagged.suggestedAgentId! }] },
        policy(),
      ),
    ).rejects.toThrow(/already waiting for an approval decision/);
    expect(
      await db.auditEvent.count({ where: { action: "approval.requested", targetId: approval.id } }),
    ).toBe(1);
  });

  it("run only after an admin or owner approves, as a task recorded against the approval", async () => {
    const { command, approval } = await requestFlagged(member);
    await expect(
      decideApproval(db, queue, member, approval.id, { decision: "approve" }, policy()),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      decideApproval(db, queue, viewer, approval.id, { decision: "approve" }, policy()),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      decideApproval(db, queue, outsider, approval.id, { decision: "approve" }, policy()),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const done = await decideApproval(
      db,
      queue,
      owner,
      approval.id,
      { decision: "approve", note: "Go ahead" },
      policy(),
    );
    expect(done).toMatchObject({
      status: "executed",
      decidedById: owner,
      decisionNote: "Go ahead",
    });
    const task = await db.task.findFirstOrThrow({
      where: { commandId: command.id, workstream: FLAGGED },
    });
    expect(done.result).toMatchObject({ taskId: task.id });
    expect(task.createdById).toBe(owner);
    expect(queue.jobs).toHaveLength(1);
    await drain();
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("succeeded");

    const actions = await db.auditEvent.findMany({
      where: { targetId: approval.id },
      orderBy: { createdAt: "asc" },
      select: { action: true },
    });
    expect(actions.map((a) => a.action)).toEqual([
      "approval.requested",
      "approval.approved",
      "approval.executed",
    ]);
  });

  it("execute at most once when two approvals race", async () => {
    const { command, approval } = await requestFlagged();
    const results = await Promise.allSettled([
      decideApproval(db, queue, owner, approval.id, { decision: "approve" }, policy()),
      decideApproval(db, queue, owner, approval.id, { decision: "approve" }, policy()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: expect.objectContaining({ message: expect.stringMatching(/already/) }),
    });
    expect(await db.task.count({ where: { commandId: command.id, workstream: FLAGGED } })).toBe(1);
  });

  it("cannot be requested again unchanged after a rejection", async () => {
    const { command, flagged, approval, agents } = await requestFlagged();
    const rejected = await decideApproval(
      db,
      queue,
      owner,
      approval.id,
      { decision: "reject", note: "Not this quarter" },
      policy(),
    );
    expect(rejected.status).toBe("rejected");
    expect(await db.task.count({ where: { commandId: command.id, workstream: FLAGGED } })).toBe(0);
    await expect(
      decideApproval(db, queue, owner, approval.id, { decision: "approve" }, policy()),
    ).rejects.toThrow(/already rejected/);

    const view = await getCommand(db, owner, command.id);
    expect(view.workstreams.find((w) => w.title === FLAGGED)).toMatchObject({
      ready: true,
      approval: { status: "rejected", decisionNote: "Not this quarter" },
    });
    const resend = {
      provider: "mock" as const,
      items: [{ workstream: FLAGGED, agentId: flagged.suggestedAgentId! }],
    };
    await expect(
      dispatchWorkstreams(db, queue, member, command.id, resend, policy()),
    ).rejects.toThrow(/was rejected on/);

    // A changed request (another agent) is a different action and may be asked for.
    const other = agents.find((a) => a.id !== flagged.suggestedAgentId)!;
    const changed = await dispatchWorkstreams(
      db,
      queue,
      member,
      command.id,
      { provider: "mock", items: [{ workstream: FLAGGED, agentId: other.id }] },
      policy(),
    );
    expect(changed.approvals[0]).toMatchObject({ status: "pending" });
  });

  it("are marked failed, not run, when the approved action can no longer be carried out", async () => {
    const live = policy({ anthropicConfigured: true });
    const { command, approval } = await requestFlagged(owner, "anthropic", live);
    expect(Number(approval.estimatedCostUsd)).toBeGreaterThan(0);
    const outcome = await decideApproval(
      db,
      queue,
      owner,
      approval.id,
      { decision: "approve" },
      policy({ anthropicConfigured: true, budget: { dailyUsd: 0.0001, monthlyUsd: 100000 } }),
    );
    expect(outcome.status).toBe("failed");
    expect(outcome.errorMessage).toMatch(/remains under your spending limits/);
    expect(await db.task.count({ where: { commandId: command.id, workstream: FLAGGED } })).toBe(0);
    expect(
      await db.auditEvent.count({ where: { action: "approval.failed", targetId: approval.id } }),
    ).toBe(1);
  });
});

describe("approval requests", () => {
  const base = () => ({
    businessId,
    action: "test.noop",
    category: "spend" as const,
    title: "Test action",
    summary: "Does nothing",
    reason: "Test",
    payload: { amount: 10, currency: "USD", nonce: crypto.randomUUID() },
    requestedBy: { type: "agent" as const, id: null },
  });

  it("are idempotent per action and fingerprint payloads independent of key order", async () => {
    const input = base();
    const a = await requestApproval(db, input);
    const b = await requestApproval(db, {
      ...input,
      payload: { nonce: input.payload.nonce, currency: "USD", amount: 10 },
    });
    expect(a.created).toBe(true);
    expect(b).toMatchObject({ created: false, request: { id: a.request.id } });
    expect(approvalFingerprint(businessId, "x", { a: 1, b: [1, { c: 2, d: 3 }] })).toBe(
      approvalFingerprint(businessId, "x", { b: [1, { d: 3, c: 2 }], a: 1 }),
    );
  });

  it("expire and can no longer be approved", async () => {
    const past = new Date(Date.now() - 100 * 3_600_000);
    const { request } = await requestApproval(db, base(), past);
    await expect(
      decideApproval(db, queue, owner, request.id, { decision: "approve" }, policy()),
    ).rejects.toThrow(/expired/);
    expect((await getApproval(db, owner, request.id)).request.status).toBe("expired");
  });

  it("with no registered handler fail instead of running anything", async () => {
    const { request } = await requestApproval(db, base());
    const outcome = await decideApproval(
      db,
      queue,
      owner,
      request.id,
      { decision: "approve" },
      policy(),
    );
    expect(outcome).toMatchObject({ status: "failed" });
    expect(outcome.errorMessage).toMatch(/No handler/);
  });

  it("can be withdrawn by their requester or an admin, not by viewers", async () => {
    const mine = await requestApproval(db, {
      ...base(),
      requestedBy: { type: "user", id: member },
    });
    await expect(cancelApproval(db, viewer, mine.request.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await cancelApproval(db, member, mine.request.id);
    expect((await getApproval(db, owner, mine.request.id)).request.status).toBe("cancelled");
    const agentRequest = await requestApproval(db, base());
    await cancelApproval(db, owner, agentRequest.request.id);
  });

  it("are listed only for members of the business, with who may decide", async () => {
    const { request } = await requestApproval(db, base());
    const forOwner = await listApprovals(db, owner);
    expect(forOwner.pending.find((r) => r.id === request.id)).toMatchObject({
      canDecide: true,
      requestedByName: "Unknown",
    });
    const forMember = await listApprovals(db, member);
    expect(forMember.pending.find((r) => r.id === request.id)?.canDecide).toBe(false);
    const forOutsider = await listApprovals(db, outsider);
    expect(forOutsider.pending.some((r) => r.id === request.id)).toBe(false);
    await expect(getApproval(db, outsider, request.id)).rejects.toBeInstanceOf(ForbiddenError);
    const overview = await getOverview(db, owner, { businessId });
    expect(overview.counts.pendingApprovals).toBeGreaterThan(0);
  });
});
