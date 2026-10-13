import { z } from "zod";
import type { ApprovalRequest, Prisma, PrismaClient, WorkflowRunStatus } from "@prince/database";
import type { ProviderName } from "@prince/ai";
import { buildSystemPrompt, buildUserPrompt } from "@prince/agents";
import { accessibleBusinessIds, requireBusinessRole } from "./access";
import { listAgents } from "./agents";
import { expireStaleApprovals, requestApproval } from "./approval-store";
import { recordAudit } from "./audit";
import { getBudgetStatus } from "./budget";
import { priceNumbers, worstCaseUsd } from "./estimate";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { forwardedResults, placeholderResults } from "./handoff";
import type { RunQueue } from "./run-queue";
import { cancelRun, requestRun, runPolicyFromEnv, type RunPolicy } from "./tasks";

/**
 * Workflows: saved multi-agent procedures. A workflow is a list of steps (agent + instructions)
 * with dependencies that form a graph without cycles. Starting a run snapshots the steps; steps
 * then start on their own as soon as the steps they depend on have succeeded, each as an ordinary
 * task and run (so budgets, reservations, retries and audit apply unchanged). Each step runs at most
 * once per run, which together with the acyclic graph rules out loops. Steps marked
 * requiresApproval never start on their own: they become approval requests and start only once an
 * admin or owner approves.
 */

export const MAX_WORKFLOW_STEPS = 12;
const MAX_RUN_INPUT_CHARS = 4_000;
/** Approval action key for starting a workflow step that requires approval. */
export const RUN_WORKFLOW_STEP_ACTION = "workflow.run_step";

export const workflowStepInput = z.object({
  title: z.string().trim().min(2, "Name each step").max(80, "Step names are at most 80 characters"),
  agentId: z.string().min(1, "Choose an agent for each step"),
  instructions: z
    .string()
    .trim()
    .min(10, "Give each step at least 10 characters of instructions")
    .max(5_000, "Step instructions are at most 5,000 characters"),
  dependsOn: z.array(z.string()).max(MAX_WORKFLOW_STEPS).default([]),
  requiresApproval: z.boolean().default(false),
});
export type WorkflowStep = z.output<typeof workflowStepInput>;
const stepsSchema = z.array(workflowStepInput);

export const workflowInput = z.object({
  businessId: z.string().min(1, "Choose a business"),
  name: z.string().trim().min(3, "Name must be at least 3 characters").max(80),
  description: z.string().trim().max(500).default(""),
  steps: z
    .array(workflowStepInput)
    .min(1, "Add at least one step")
    .max(MAX_WORKFLOW_STEPS, `A workflow has at most ${MAX_WORKFLOW_STEPS} steps`),
});
export type WorkflowInput = z.input<typeof workflowInput>;

function invalid(message: string, field = "steps"): never {
  throw new ValidationError(message, { [field]: [message] });
}

/** Rejects duplicate names, unknown or self dependencies, and cycles. */
export function validateStepGraph(steps: WorkflowStep[]) {
  const titles = steps.map((s) => s.title.toLowerCase());
  if (new Set(titles).size !== titles.length) invalid("Each step needs a different name");
  const byTitle = new Map(steps.map((s) => [s.title, s]));
  for (const s of steps) {
    if (s.dependsOn.includes(s.title)) invalid(`"${s.title}" cannot depend on itself`);
    for (const d of s.dependsOn)
      if (!byTitle.has(d)) invalid(`"${s.title}" depends on "${d}", which is not a step`);
  }
  // Kahn's algorithm: if some steps can never become ready, they form a cycle.
  const remaining = new Map(steps.map((s) => [s.title, new Set(s.dependsOn)]));
  let progressed = true;
  while (remaining.size && progressed) {
    progressed = false;
    for (const [title, deps] of remaining) {
      if (deps.size === 0) {
        remaining.delete(title);
        for (const other of remaining.values()) other.delete(title);
        progressed = true;
      }
    }
  }
  if (remaining.size)
    invalid(`These steps depend on each other in a loop: ${[...remaining.keys()].join(", ")}`);
}

/** Agents a business's workflows can use: active, executable, shared or owned by the business. */
async function usableAgents(db: PrismaClient, userId: string, businessId: string) {
  return (await listAgents(db, userId)).filter(
    (a) =>
      a.status === "active" &&
      a.executable &&
      (a.businessId === null || a.businessId === businessId),
  );
}

async function parseWorkflowInput(db: PrismaClient, userId: string, raw: WorkflowInput) {
  const parsed = workflowInput.safeParse(raw);
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error);
    const stepIssue = parsed.error.issues.find((i) => i.path[0] === "steps");
    throw new ValidationError("Check the highlighted fields", {
      ...flat.fieldErrors,
      ...(stepIssue
        ? {
            steps: [
              typeof stepIssue.path[1] === "number"
                ? `Step ${stepIssue.path[1] + 1}: ${stepIssue.message}`
                : stepIssue.message,
            ],
          }
        : {}),
    });
  }
  const input = parsed.data;
  validateStepGraph(input.steps);
  const agents = await usableAgents(db, userId, input.businessId);
  for (const s of input.steps)
    if (!agents.some((a) => a.id === s.agentId))
      invalid(`The agent chosen for "${s.title}" is not available to this business`);
  return input;
}

export async function createWorkflow(db: PrismaClient, userId: string, raw: WorkflowInput) {
  const businessId = typeof raw?.businessId === "string" ? raw.businessId : "";
  if (businessId) await requireBusinessRole(db, userId, businessId, "admin");
  const input = await parseWorkflowInput(db, userId, raw);
  await requireBusinessRole(db, userId, input.businessId, "admin");
  return db.$transaction(async (tx) => {
    const workflow = await tx.workflow.create({
      data: {
        businessId: input.businessId,
        name: input.name,
        description: input.description,
        steps: input.steps as unknown as Prisma.InputJsonValue,
        createdById: userId,
      },
    });
    await recordAudit(tx, {
      actorType: "user",
      actorId: userId,
      businessId: input.businessId,
      action: "workflow.created",
      targetType: "workflow",
      targetId: workflow.id,
      summary: `Created workflow "${workflow.name}" with ${input.steps.length} step(s)`,
    });
    return workflow;
  });
}

/** Saves new steps. Runs already started keep the steps they started with. */
export async function updateWorkflow(
  db: PrismaClient,
  userId: string,
  workflowId: string,
  raw: WorkflowInput,
  expectedVersion: number,
) {
  const existing = await db.workflow.findUnique({ where: { id: workflowId } });
  if (!existing) throw new NotFoundError("Workflow");
  await requireBusinessRole(db, userId, existing.businessId, "admin");
  const input = await parseWorkflowInput(db, userId, { ...raw, businessId: existing.businessId });
  return db.$transaction(async (tx) => {
    const updated = await tx.workflow.updateMany({
      where: { id: workflowId, version: expectedVersion },
      data: {
        name: input.name,
        description: input.description,
        steps: input.steps as unknown as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });
    if (updated.count === 0)
      throw new ValidationError("This workflow was changed by someone else. Reload and try again.");
    await recordAudit(tx, {
      actorType: "user",
      actorId: userId,
      businessId: existing.businessId,
      action: "workflow.updated",
      targetType: "workflow",
      targetId: workflowId,
      summary: `Saved "${input.name}" v${expectedVersion + 1} (${input.steps.length} step(s))`,
    });
    return { version: expectedVersion + 1 };
  });
}

export async function setWorkflowStatus(
  db: PrismaClient,
  userId: string,
  workflowId: string,
  status: "active" | "disabled" | "archived",
) {
  if (!["active", "disabled", "archived"].includes(status))
    throw new ValidationError("Unknown status");
  const workflow = await db.workflow.findUnique({ where: { id: workflowId } });
  if (!workflow) throw new NotFoundError("Workflow");
  await requireBusinessRole(db, userId, workflow.businessId, "admin");
  if (workflow.status === status) return workflow;
  return db.$transaction(async (tx) => {
    const updated = await tx.workflow.update({ where: { id: workflowId }, data: { status } });
    await recordAudit(tx, {
      actorType: "user",
      actorId: userId,
      businessId: workflow.businessId,
      action: `workflow.${status === "active" ? "enabled" : status}`,
      targetType: "workflow",
      targetId: workflowId,
      summary: `${workflow.name}: ${workflow.status} → ${status}`,
    });
    return updated;
  });
}

/** Businesses the user may edit workflows for, and the agents each one can use. */
export async function workflowEditorOptions(db: PrismaClient, userId: string) {
  const memberships = await db.membership.findMany({
    where: { userId, role: { in: ["admin", "owner"] }, business: { archivedAt: null } },
    include: { business: { select: { id: true, name: true } } },
    orderBy: { business: { createdAt: "asc" } },
  });
  const agents = (await listAgents(db, userId)).filter(
    (a) => a.status === "active" && a.executable,
  );
  return {
    businesses: memberships.map((m) => m.business),
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      division: a.division,
      /** null: a built-in agent every business can use. */
      businessId: a.businessId,
    })),
  };
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export interface WorkflowTemplate {
  key: string;
  name: string;
  description: string;
  steps: (Omit<WorkflowStep, "agentId"> & { agentTemplateKey: string })[];
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    key: "product-idea-validation",
    name: "Product idea validation",
    description:
      "Research a product idea, check its unit economics, then draft launch copy once you approve.",
    steps: [
      {
        title: "Market research",
        agentTemplateKey: "market-research",
        instructions:
          "Assess demand, target customers and competitors for this product idea: {{input}}",
        dependsOn: [],
        requiresApproval: false,
      },
      {
        title: "Unit economics",
        agentTemplateKey: "financial-analyst",
        instructions:
          "Estimate price points, unit costs and margins for this product idea, using the research results and stating every assumption: {{input}}",
        dependsOn: ["Market research"],
        requiresApproval: false,
      },
      {
        title: "Launch copy",
        agentTemplateKey: "copywriting",
        instructions:
          "Draft a product page headline, a short description and three ad variants for: {{input}}. Base every claim on the earlier results.",
        dependsOn: ["Market research", "Unit economics"],
        requiresApproval: true,
      },
    ],
  },
  {
    key: "campaign-copy",
    name: "Campaign copy from research",
    description: "Research an audience, then draft campaign copy for it once you approve.",
    steps: [
      {
        title: "Audience research",
        agentTemplateKey: "market-research",
        instructions:
          "Describe the audience, its needs and the messages competitors use for this campaign: {{input}}",
        dependsOn: [],
        requiresApproval: false,
      },
      {
        title: "Campaign copy",
        agentTemplateKey: "copywriting",
        instructions:
          "Draft campaign copy (headlines, body, calls to action) for: {{input}}. Use the audience research.",
        dependsOn: ["Audience research"],
        requiresApproval: true,
      },
    ],
  },
];

export async function createWorkflowFromTemplate(
  db: PrismaClient,
  userId: string,
  businessId: string,
  templateKey: string,
) {
  const template = WORKFLOW_TEMPLATES.find((t) => t.key === templateKey);
  if (!template) throw new ValidationError("Unknown workflow template");
  await requireBusinessRole(db, userId, businessId, "admin");
  const agents = await db.agent.findMany({
    where: {
      businessId: null,
      templateKey: { in: template.steps.map((s) => s.agentTemplateKey) },
    },
  });
  return createWorkflow(db, userId, {
    businessId,
    name: template.name,
    description: template.description,
    steps: template.steps.map(({ agentTemplateKey, ...s }) => {
      const agent = agents.find((a) => a.templateKey === agentTemplateKey);
      if (!agent) throw new ValidationError(`The built-in agent "${agentTemplateKey}" is missing`);
      return { ...s, agentId: agent.id };
    }),
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function listWorkflows(db: PrismaClient, userId: string) {
  const businessIds = await accessibleBusinessIds(db, userId);
  const workflows = await db.workflow.findMany({
    where: { businessId: { in: businessIds }, status: { not: "archived" } },
    orderBy: { updatedAt: "desc" },
    include: {
      business: { select: { id: true, name: true } },
      runs: { orderBy: { createdAt: "desc" }, take: 1 },
      _count: { select: { runs: true } },
    },
  });
  return workflows.map((w) => ({
    id: w.id,
    name: w.name,
    description: w.description,
    status: w.status,
    business: w.business,
    stepCount: stepsSchema.safeParse(w.steps).data?.length ?? 0,
    runCount: w._count.runs,
    lastRun: w.runs[0] ?? null,
  }));
}

/** Worst-case USD of each step for the given input, using the same formula as the worker. */
async function estimateSteps(
  db: PrismaClient,
  business: { name: string; description: string; businessModel: string; goals: string[] },
  workflowName: string,
  steps: WorkflowStep[],
  input: string,
) {
  const agents = await db.agent.findMany({
    where: { id: { in: steps.map((s) => s.agentId) } },
    select: { id: true, currentVersion: true },
  });
  const versions = await db.agentVersion.findMany({
    where: { OR: agents.map((a) => ({ agentId: a.id, version: a.currentVersion })) },
  });
  const prices = await db.modelPrice.findMany({
    where: { model: { in: [...new Set(versions.map((v) => v.model))] } },
  });
  return steps.map((step) => {
    const v = versions.find((x) => x.agentId === step.agentId);
    const price = v && prices.find((p) => p.model === v.model);
    if (!v || !price) return null;
    return worstCaseUsd(
      buildSystemPrompt(v.systemPrompt),
      buildUserPrompt(business, {
        title: step.title,
        instructions: stepInstructions(
          workflowName,
          step,
          input,
          placeholderResults(step.dependsOn),
        ),
      }),
      v.outputSchemaKey,
      v.maxOutputTokens,
      priceNumbers(price),
    );
  });
}

export async function getWorkflow(db: PrismaClient, userId: string, workflowId: string) {
  const workflow = await db.workflow.findUnique({
    where: { id: workflowId },
    include: {
      business: true,
      createdBy: { select: { name: true } },
      runs: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { startedBy: { select: { name: true } } },
      },
    },
  });
  if (!workflow) throw new NotFoundError("Workflow");
  const role = await requireBusinessRole(db, userId, workflow.businessId, "viewer");
  const steps = stepsSchema.parse(workflow.steps);
  const agents = await usableAgents(db, userId, workflow.businessId);
  const agentNames = new Map(
    (await db.agent.findMany({ where: { id: { in: steps.map((s) => s.agentId) } } })).map((a) => [
      a.id,
      a.name,
    ]),
  );
  // Estimate with a full-length input so the figure is an upper bound for any allowed input.
  const estimates = await estimateSteps(
    db,
    workflow.business,
    workflow.name,
    steps,
    "x".repeat(MAX_RUN_INPUT_CHARS),
  );
  return {
    workflow,
    steps: steps.map((s, i) => ({
      ...s,
      agentName: agentNames.get(s.agentId) ?? "Unknown agent",
      agentAvailable: agents.some((a) => a.id === s.agentId),
      worstCaseUsd: estimates[i] ?? null,
    })),
    totalWorstCaseUsd: estimates.reduce<number>((n, e) => n + (e ?? 0), 0),
    agents: agents.map((a) => ({ id: a.id, name: a.name })),
    canEdit: role === "admin" || role === "owner",
    canRun: role !== "viewer",
  };
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

export const startWorkflowRunInput = z.object({
  input: z
    .string()
    .trim()
    .min(3, "Describe what this run should work on")
    .max(
      MAX_RUN_INPUT_CHARS,
      `Keep the input under ${MAX_RUN_INPUT_CHARS.toLocaleString("en-US")} characters`,
    ),
  provider: z.enum(["anthropic", "mock"]),
  idempotencyKey: z.string().uuid(),
});
export type StartWorkflowRunInput = z.input<typeof startWorkflowRunInput>;

function stepInstructions(
  workflowName: string,
  step: WorkflowStep,
  input: string,
  dependencies: { title: string; output: string }[],
): string {
  const usesInput = step.instructions.includes("{{input}}");
  const parts = [
    step.instructions.replaceAll("{{input}}", input),
    "",
    `This is the step "${step.title}" of the workflow "${workflowName}".`,
  ];
  if (!usesInput) parts.push(`Input for this run: ${input}`);
  if (step.requiresApproval)
    parts.push("", "The owner approved this step. Produce recommendations and drafts only.");
  parts.push(...forwardedResults(dependencies, "step"));
  return parts.join("\n");
}

/**
 * Starts a run: snapshots the steps, checks (for paid runs) that the worst case of every step
 * together fits what remains under the spending limits, then starts the steps that are ready.
 */
export async function startWorkflowRun(
  db: PrismaClient,
  queue: RunQueue,
  userId: string,
  workflowId: string,
  raw: StartWorkflowRunInput,
  policy: RunPolicy = runPolicyFromEnv(),
) {
  const parsed = startWorkflowRunInput.safeParse(raw);
  if (!parsed.success)
    throw new ValidationError("Check the input", z.flattenError(parsed.error).fieldErrors);
  const { input, provider, idempotencyKey } = parsed.data;
  const previous = async () => {
    const existing = await db.workflowRun.findUnique({ where: { clientKey: idempotencyKey } });
    if (existing && (existing.workflowId !== workflowId || existing.startedById !== userId))
      throw new ForbiddenError("Idempotency key already used");
    return existing;
  };
  const existing = await previous();
  if (existing) return existing;

  const workflow = await db.workflow.findUnique({
    where: { id: workflowId },
    include: { business: true },
  });
  if (!workflow) throw new NotFoundError("Workflow");
  await requireBusinessRole(db, userId, workflow.businessId, "member");
  if (workflow.status !== "active")
    throw new ValidationError(`This workflow is ${workflow.status}; enable it to run it`);
  const steps = stepsSchema.parse(workflow.steps);
  const agents = await usableAgents(db, userId, workflow.businessId);
  for (const s of steps)
    if (!agents.some((a) => a.id === s.agentId))
      throw new ValidationError(
        `The agent for "${s.title}" is no longer available. Edit the workflow to choose another.`,
      );

  if (provider === "mock" && !policy.allowMock)
    throw new ValidationError("Dry runs with the mock provider are disabled in production");
  let estimatedMaxUsd: number | null = null;
  if (provider === "anthropic") {
    if (!policy.anthropicConfigured)
      throw new ValidationError(
        "Claude is not configured: add ANTHROPIC_API_KEY to the server environment, or start a dry run.",
      );
    const estimates = await estimateSteps(db, workflow.business, workflow.name, steps, input);
    const unpriced = steps.filter((_, i) => estimates[i] == null).map((s) => s.title);
    if (unpriced.length)
      throw new ValidationError(
        `No price is configured for the model used by ${unpriced.join(", ")}, so the cost cannot be bounded.`,
      );
    estimatedMaxUsd = estimates.reduce<number>((n, e) => n + (e ?? 0), 0);
    const budget = await getBudgetStatus(db, policy.budget);
    const room = Math.min(budget.day.remainingUsd, budget.month.remainingUsd);
    if (estimatedMaxUsd > room)
      throw new ValidationError(
        `All steps together could cost up to $${estimatedMaxUsd.toFixed(4)}, but only $${room.toFixed(4)} remains under your spending limits. Use a dry run or wait for the limit to reset.`,
      );
  }

  let run;
  try {
    run = await db.$transaction(async (tx) => {
      const created = await tx.workflowRun.create({
        data: {
          workflowId,
          businessId: workflow.businessId,
          workflowVersion: workflow.version,
          definition: steps as unknown as Prisma.InputJsonValue,
          input,
          provider,
          estimatedMaxUsd,
          startedById: userId,
          clientKey: idempotencyKey,
        },
      });
      await recordAudit(tx, {
        actorType: "user",
        actorId: userId,
        businessId: workflow.businessId,
        action: "workflow.run_started",
        targetType: "workflow_run",
        targetId: created.id,
        summary: `Started "${workflow.name}" v${workflow.version} as ${provider === "mock" ? "a dry run" : "Claude runs"}`,
      });
      return created;
    });
  } catch (error) {
    // The same start request sent twice at once: the second insert loses; return the first.
    const first = (error as { code?: string }).code === "P2002" ? await previous() : null;
    if (!first) throw error;
    return first;
  }
  await advanceWorkflowRun(db, queue, run.id, policy);
  return db.workflowRun.findUniqueOrThrow({ where: { id: run.id } });
}

async function loadRun(db: PrismaClient, runId: string) {
  return db.workflowRun.findUnique({
    where: { id: runId },
    include: {
      workflow: { select: { id: true, name: true } },
      business: true,
      tasks: {
        include: {
          agent: { select: { id: true, name: true } },
          runs: { orderBy: { queuedAt: "desc" } },
        },
      },
    },
  });
}
type LoadedRun = NonNullable<Awaited<ReturnType<typeof loadRun>>>;

function approvalForStep(approvals: ApprovalRequest[], title: string) {
  return approvals.find((a) => (a.payload as { step?: string } | null)?.step === title);
}

/** Creates the step's task and requests its run. Returns null if another caller just did. */
async function dispatchStep(
  db: PrismaClient,
  queue: RunQueue,
  run: LoadedRun,
  step: WorkflowStep,
  userId: string,
  policy: RunPolicy,
  approvalId?: string,
) {
  const dependencies = step.dependsOn.map((title) => {
    const t = run.tasks.find((x) => x.workflowStep === title);
    return { title, output: t?.runs.find((r) => r.status === "succeeded")?.outputText ?? "" };
  });
  let task;
  try {
    task = await db.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          businessId: run.businessId,
          agentId: step.agentId,
          workflowRunId: run.id,
          workflowStep: step.title,
          title: step.title,
          instructions: stepInstructions(run.workflow.name, step, run.input, dependencies).slice(
            0,
            20_000,
          ),
          createdById: userId,
        },
      });
      await recordAudit(tx, {
        actorType: "user",
        actorId: userId,
        businessId: run.businessId,
        action: "workflow.step_started",
        targetType: "workflow_run",
        targetId: run.id,
        summary: `Started step "${step.title}" of "${run.workflow.name}"${approvalId ? " after approval" : ""}`,
        metadata: approvalId ? { approvalId } : undefined,
      });
      return created;
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return null;
    throw error;
  }
  try {
    await requestRun(db, queue, userId, task.id, {
      provider: run.provider as ProviderName,
      policy,
    });
  } catch (error) {
    // The step cannot run (for example a spending limit was reached): record it as failed so the
    // workflow run shows why it stopped.
    await db.task.update({ where: { id: task.id }, data: { status: "failed" } });
    throw error;
  }
  return task;
}

/**
 * Brings a workflow run up to date: starts every step whose dependencies have succeeded (or asks
 * for approval when the step requires it), then derives the run's status from its steps. Safe to
 * call repeatedly and concurrently: a step's task is unique per run, approval requests are
 * idempotent, and the status is always recomputed from current records.
 */
export async function advanceWorkflowRun(
  db: PrismaClient,
  queue: RunQueue,
  runId: string,
  policy: RunPolicy = runPolicyFromEnv(),
) {
  const run = await loadRun(db, runId);
  if (!run || run.status === "cancelled") return run;
  const steps = stepsSchema.parse(run.definition);
  await expireStaleApprovals(db);
  const approvals = await db.approvalRequest.findMany({
    where: { targetType: "workflow_run", targetId: runId, action: RUN_WORKFLOW_STEP_ACTION },
    orderBy: { createdAt: "desc" },
  });
  const taskFor = (title: string) => run.tasks.find((t) => t.workflowStep === title);
  const succeeded = (title: string) => taskFor(title)?.status === "succeeded";
  const problems: string[] = [];

  for (const step of steps) {
    if (taskFor(step.title) || !step.dependsOn.every(succeeded)) continue;
    if (step.requiresApproval) {
      const latest = approvalForStep(approvals, step.title);
      // Any earlier request (pending, approved, or declined) settles this step; settle reports it.
      if (latest) continue;
      const estimate =
        run.provider === "anthropic"
          ? ((await estimateSteps(db, run.business, run.workflow.name, [step], run.input))[0] ??
            null)
          : 0;
      await requestApproval(db, {
        businessId: run.businessId,
        action: RUN_WORKFLOW_STEP_ACTION,
        category: "owner_flagged",
        title: `Run step "${step.title}" of "${run.workflow.name}"`,
        summary: `Starts the step "${step.title}" of the workflow "${run.workflow.name}" (input: "${run.input.slice(0, 160)}") as ${run.provider === "mock" ? "a dry run (no charge)" : `a paid Claude run (worst case $${(estimate ?? 0).toFixed(4)})`}. The agent produces analysis and drafts only; nothing is published, purchased, sent or paid.`,
        reason: "The workflow marks this step as requiring approval before it runs.",
        payload: { workflowRunId: runId, step: step.title },
        estimatedCostUsd: estimate,
        requestedBy: { type: "user", id: run.startedById },
        target: { type: "workflow_run", id: runId },
      });
      continue;
    }
    try {
      await dispatchStep(db, queue, run, step, run.startedById, policy);
    } catch (error) {
      problems.push(
        `Step "${step.title}" could not start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return settleWorkflowRun(db, runId, problems);
}

/** Approval outcomes that mean a step will not run. */
const DECLINED_APPROVAL = new Set(["rejected", "expired", "cancelled", "failed"]);

function declinedReason(step: WorkflowStep, approval: ApprovalRequest) {
  switch (approval.status) {
    case "rejected":
      return `Step "${step.title}" was rejected${approval.decisionNote ? `: ${approval.decisionNote}` : ""}`;
    case "expired":
      return `The approval request for step "${step.title}" expired`;
    case "cancelled":
      return `The approval request for step "${step.title}" was withdrawn`;
    default:
      return `Step "${step.title}" was approved but could not start: ${approval.errorMessage ?? "unknown error"}`;
  }
}

/**
 * Derives and stores the run's status from its steps' tasks and approvals. Also called after an
 * approval for one of its steps is rejected, withdrawn or expires.
 */
export async function settleWorkflowRun(db: PrismaClient, runId: string, extra: string[] = []) {
  const run = await loadRun(db, runId);
  if (!run || run.status === "cancelled") return run;
  const steps = stepsSchema.parse(run.definition);
  await expireStaleApprovals(db);
  const approvals = await db.approvalRequest.findMany({
    where: { targetType: "workflow_run", targetId: runId, action: RUN_WORKFLOW_STEP_ACTION },
    orderBy: { createdAt: "desc" },
  });
  const pendingApprovals = approvals.filter(
    (a) => a.status === "pending" || a.status === "approved",
  ).length;
  const problems = [...extra];
  for (const step of steps) {
    if (!step.requiresApproval || run.tasks.some((t) => t.workflowStep === step.title)) continue;
    const latest = approvalForStep(approvals, step.title);
    if (latest && DECLINED_APPROVAL.has(latest.status)) problems.push(declinedReason(step, latest));
  }
  const statuses = steps.map((s) => run.tasks.find((t) => t.workflowStep === s.title)?.status);
  const active = statuses.some((s) => s === "queued" || s === "running" || s === "open");
  const failedStep = steps.find((s, i) => statuses[i] === "failed" || statuses[i] === "cancelled");

  let status: WorkflowRunStatus;
  let error: string | null = null;
  if (statuses.every((s) => s === "succeeded")) status = "succeeded";
  else if (active) status = "running";
  else if (failedStep || problems.length) {
    status = "failed";
    error = problems[0] ?? `Step "${failedStep!.title}" ${statuses[steps.indexOf(failedStep!)]}`;
  } else if (pendingApprovals > 0) status = "waiting_approval";
  else status = "running";

  const terminal = status === "succeeded" || status === "failed";
  if (status !== run.status || error !== run.error) {
    // Conditional so a cancellation that lands meanwhile is never overwritten.
    const changed = await db.workflowRun.updateMany({
      where: { id: runId, status: { not: "cancelled" } },
      data: { status, error, finishedAt: terminal ? (run.finishedAt ?? new Date()) : null },
    });
    if (changed.count && terminal && run.status !== status)
      await recordAudit(db, {
        actorType: "system",
        businessId: run.businessId,
        action: `workflow.run_${status}`,
        targetType: "workflow_run",
        targetId: runId,
        summary: `"${run.workflow.name}" ${status}${error ? `: ${error}` : ""}`.slice(0, 500),
      });
  }
  return db.workflowRun.findUnique({ where: { id: runId } });
}

/** Called when an agent run ends (worker) or is cancelled or retried (web): advances its workflow. */
export async function onAgentRunSettled(
  db: PrismaClient,
  queue: RunQueue,
  agentRunId: string,
  policy: RunPolicy = runPolicyFromEnv(),
) {
  const run = await db.agentRun.findUnique({
    where: { id: agentRunId },
    select: { task: { select: { workflowRunId: true } } },
  });
  const workflowRunId = run?.task.workflowRunId;
  if (!workflowRunId) return null;
  return advanceWorkflowRun(db, queue, workflowRunId, policy);
}

const stepApprovalPayload = z.object({ workflowRunId: z.string(), step: z.string() });

/** Approval handler: starts a step that required approval, then continues the run. */
export async function executeApprovedWorkflowStep(
  db: PrismaClient,
  queue: RunQueue,
  approverId: string,
  request: ApprovalRequest,
  policy: RunPolicy,
) {
  const payload = stepApprovalPayload.parse(request.payload);
  const run = await loadRun(db, payload.workflowRunId);
  if (!run || run.businessId !== request.businessId)
    throw new ValidationError("The workflow run no longer exists");
  if (run.status === "cancelled") throw new ValidationError("The workflow run was cancelled");
  const step = stepsSchema.parse(run.definition).find((s) => s.title === payload.step);
  if (!step) throw new ValidationError(`"${payload.step}" is not a step of this run`);
  if (run.tasks.some((t) => t.workflowStep === step.title))
    throw new ValidationError(`"${step.title}" has already started`);
  const unmet = step.dependsOn.filter(
    (d) => run.tasks.find((t) => t.workflowStep === d)?.status !== "succeeded",
  );
  if (unmet.length) throw new ValidationError(`"${step.title}" is waiting on ${unmet.join(", ")}`);
  if (run.provider === "anthropic") {
    if (!policy.anthropicConfigured) throw new ValidationError("Claude is not configured");
    const [estimate] = await estimateSteps(db, run.business, run.workflow.name, [step], run.input);
    const budget = await getBudgetStatus(db, policy.budget);
    const room = Math.min(budget.day.remainingUsd, budget.month.remainingUsd);
    if ((estimate ?? 0) > room)
      throw new ValidationError(
        `This step could cost up to $${(estimate ?? 0).toFixed(4)}, but only $${room.toFixed(4)} remains under your spending limits.`,
      );
  }
  const task = await dispatchStep(db, queue, run, step, approverId, policy, request.id);
  if (!task) throw new ValidationError(`"${step.title}" has already started`);
  await settleWorkflowRun(db, run.id);
  return { taskId: task.id, workflowRunId: run.id };
}

export async function cancelWorkflowRun(
  db: PrismaClient,
  queue: RunQueue,
  userId: string,
  runId: string,
) {
  const run = await loadRun(db, runId);
  if (!run) throw new NotFoundError("Workflow run");
  await requireBusinessRole(db, userId, run.businessId, "member");
  const claimed = await db.workflowRun.updateMany({
    where: { id: runId, status: { notIn: ["succeeded", "cancelled"] } },
    data: { status: "cancelled", finishedAt: new Date() },
  });
  if (claimed.count === 0) throw new ValidationError(`This run already ${run.status}`);
  for (const t of run.tasks)
    for (const r of t.runs)
      if (r.status === "queued" || r.status === "running")
        await cancelRun(db, queue, userId, r.id).catch(() => undefined);
  await db.approvalRequest.updateMany({
    where: { targetType: "workflow_run", targetId: runId, status: "pending" },
    data: { status: "cancelled", decidedById: userId, decidedAt: new Date() },
  });
  await recordAudit(db, {
    actorType: "user",
    actorId: userId,
    businessId: run.businessId,
    action: "workflow.run_cancelled",
    targetType: "workflow_run",
    targetId: runId,
    summary: `Cancelled a run of "${run.workflow.name}"`,
  });
}

export async function getWorkflowRun(db: PrismaClient, userId: string, runId: string) {
  const found = await db.workflowRun.findUnique({ where: { id: runId } });
  if (!found) throw new NotFoundError("Workflow run");
  const role = await requireBusinessRole(db, userId, found.businessId, "viewer");
  // Refresh first so an approval that expired since the last event is reflected.
  await settleWorkflowRun(db, runId);
  const run = (await loadRun(db, runId))!;
  const approvals = await db.approvalRequest.findMany({
    where: { targetType: "workflow_run", targetId: runId },
    orderBy: { createdAt: "desc" },
  });
  const steps = stepsSchema.parse(run.definition);
  const startedBy = await db.user.findUnique({
    where: { id: run.startedById },
    select: { name: true },
  });
  const agentNames = new Map(
    (await db.agent.findMany({ where: { id: { in: steps.map((s) => s.agentId) } } })).map((a) => [
      a.id,
      a.name,
    ]),
  );
  const succeeded = (title: string) =>
    run.tasks.find((t) => t.workflowStep === title)?.status === "succeeded";
  return {
    run,
    startedByName: startedBy?.name ?? "Unknown",
    canCancel: role !== "viewer" && (run.status === "running" || run.status === "waiting_approval"),
    steps: steps.map((s) => {
      const task = run.tasks.find((t) => t.workflowStep === s.title) ?? null;
      const latestRun = task?.runs[0] ?? null;
      const approval = approvalForStep(approvals, s.title) ?? null;
      return {
        ...s,
        agentName: agentNames.get(s.agentId) ?? "Unknown agent",
        task: task ? { id: task.id, status: task.status } : null,
        latestRun: latestRun
          ? {
              status: latestRun.status,
              provider: latestRun.provider,
              costUsd: latestRun.costUsd == null ? null : Number(latestRun.costUsd),
            }
          : null,
        approval: approval ? { id: approval.id, status: approval.status } : null,
        waitingOn: s.dependsOn.filter((d) => !succeeded(d)),
      };
    }),
    costUsd: run.tasks.reduce(
      (n, t) => n + t.runs.reduce((m, r) => m + Number(r.costUsd ?? 0), 0),
      0,
    ),
  };
}

/** Compact signature of a workflow run's progress, polled by the UI. */
export async function workflowRunSignature(db: PrismaClient, userId: string, runId: string) {
  const run = await db.workflowRun.findUnique({
    where: { id: runId },
    select: {
      businessId: true,
      status: true,
      tasks: { select: { id: true, status: true, runs: { select: { status: true } } } },
    },
  });
  if (!run) throw new NotFoundError("Workflow run");
  await requireBusinessRole(db, userId, run.businessId, "viewer");
  const approvals = await db.approvalRequest.findMany({
    where: { targetType: "workflow_run", targetId: runId },
    select: { id: true, status: true },
  });
  const parts = [
    `run:${run.status}`,
    ...run.tasks.map((t) => `${t.id}:${t.status}:${t.runs.map((r) => r.status).join(",")}`),
    ...approvals.map((a) => `${a.id}:${a.status}`),
  ].sort();
  return {
    signature: parts.join("|"),
    active: run.status === "running",
  };
}
