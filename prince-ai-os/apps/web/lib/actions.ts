"use server";
import { revalidatePath } from "next/cache";
import { AnthropicProvider } from "@prince/ai";
import {
  ValidationError,
  cancelApproval,
  cancelRun,
  cancelWorkflowRun,
  createBusiness,
  createCommand,
  createCustomAgent,
  createTask,
  createWorkflow,
  createWorkflowFromTemplate,
  decideApproval,
  dispatchWorkstreams,
  duplicateAgent,
  onAgentRunSettled,
  restoreAgentVersion,
  setAgentStatus,
  setWorkflowStatus,
  startAgentTest,
  startWorkflowRun,
  updateAgentConfig,
  updateWorkflow,
  recordAudit,
  requestRun,
  retryRun,
  type AgentConfigInput,
  type CreateCommandInput,
  type DispatchInput,
  type CreateAgentInput,
  type CreateBusinessInput,
  type CreateTaskInput,
  type DecideApprovalInput,
  type StartWorkflowRunInput,
  type TestRunInput,
  type WorkflowInput,
} from "@prince/core";
import { run, type ActionResult } from "./action-result";
import { db, env, getRunQueue } from "./server";
import { requireUser } from "./session";

export async function createBusinessAction(
  input: CreateBusinessInput,
): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  return run(async () => {
    const b = await createBusiness(db, user.id, input);
    revalidatePath("/businesses");
    return { id: b.id };
  });
}

export async function createTaskAction(
  input: CreateTaskInput,
): Promise<ActionResult<{ taskId: string }>> {
  const user = await requireUser();
  return run(async () => {
    const { task } = await createTask(db, getRunQueue(), user.id, input);
    revalidatePath("/tasks");
    return { taskId: task.id };
  });
}

export async function runTaskAction(
  taskId: string,
  idempotencyKey: string,
  provider?: "anthropic" | "mock",
): Promise<ActionResult<{ runId: string }>> {
  const user = await requireUser();
  return run(async () => {
    if (provider !== undefined && provider !== "anthropic" && provider !== "mock")
      throw new ValidationError("Unknown provider");
    const r = await requestRun(db, getRunQueue(), user.id, taskId, { idempotencyKey, provider });
    revalidatePath(`/tasks/${taskId}`);
    return { runId: r.id };
  });
}

/** Lets a workflow react to a run that was cancelled or retried here (the worker covers the rest). */
async function settleWorkflowFor(runId: string) {
  try {
    await onAgentRunSettled(db, getRunQueue(), runId);
  } catch (error) {
    console.error("[action] workflow update failed", error);
  }
  revalidatePath("/workflows", "layout");
}

export async function cancelRunAction(runId: string): Promise<ActionResult> {
  const user = await requireUser();
  return run(async () => {
    await cancelRun(db, getRunQueue(), user.id, runId);
    await settleWorkflowFor(runId);
    revalidatePath("/tasks", "layout");
    return undefined;
  });
}

export async function retryRunAction(runId: string): Promise<ActionResult<{ runId: string }>> {
  const user = await requireUser();
  return run(async () => {
    const r = await retryRun(db, getRunQueue(), user.id, runId);
    await settleWorkflowFor(r.id);
    revalidatePath("/tasks", "layout");
    return { runId: r.id };
  });
}

/** Verifies the configured Anthropic key with a metadata call (no tokens generated, no charge). */
export async function testAnthropicAction(): Promise<ActionResult<{ message: string }>> {
  const user = await requireUser();
  return run(async () => {
    if (!env.ANTHROPIC_API_KEY)
      return { message: "Not configured: ANTHROPIC_API_KEY is not set on the server." };
    const result = await new AnthropicProvider(env.ANTHROPIC_API_KEY).testConnection(
      env.AI_DEFAULT_MODEL,
    );
    await recordAudit(db, {
      actorType: "user",
      actorId: user.id,
      action: "integration.tested",
      targetType: "integration",
      targetId: "anthropic",
      summary: result.ok ? "Anthropic connection test passed" : "Anthropic connection test failed",
    });
    return {
      message: result.ok
        ? `Connected. ${result.displayName} is available.`
        : `Error: ${result.error}`,
    };
  });
}

// ---------------------------------------------------------------------------
// Agent Builder
// ---------------------------------------------------------------------------

function revalidateAgents(agentId?: string) {
  revalidatePath("/agents");
  revalidatePath("/agent-builder");
  if (agentId) {
    revalidatePath(`/agents/${agentId}`);
    revalidatePath(`/agent-builder/${agentId}`);
  }
}

export async function createAgentAction(
  input: CreateAgentInput,
): Promise<ActionResult<{ agentId: string }>> {
  const user = await requireUser();
  return run(async () => {
    const agent = await createCustomAgent(db, user.id, input);
    revalidateAgents();
    return { agentId: agent.id };
  });
}

export async function updateAgentAction(
  agentId: string,
  expectedVersion: number,
  input: AgentConfigInput,
): Promise<ActionResult<{ version: number }>> {
  const user = await requireUser();
  return run(async () => {
    const r = await updateAgentConfig(db, user.id, agentId, input, expectedVersion);
    revalidateAgents(agentId);
    return r;
  });
}

export async function restoreAgentVersionAction(
  agentId: string,
  version: number,
): Promise<ActionResult<{ version: number }>> {
  const user = await requireUser();
  return run(async () => {
    const r = await restoreAgentVersion(db, user.id, agentId, version);
    revalidateAgents(agentId);
    return r;
  });
}

export async function setAgentStatusAction(
  agentId: string,
  status: "active" | "disabled" | "archived",
): Promise<ActionResult> {
  const user = await requireUser();
  return run(async () => {
    await setAgentStatus(db, user.id, agentId, status);
    revalidateAgents(agentId);
    return undefined;
  });
}

export async function duplicateAgentAction(
  agentId: string,
  businessId: string,
): Promise<ActionResult<{ agentId: string }>> {
  const user = await requireUser();
  return run(async () => {
    const agent = await duplicateAgent(db, user.id, agentId, businessId);
    revalidateAgents();
    return { agentId: agent.id };
  });
}

export async function testAgentAction(
  agentId: string,
  input: TestRunInput,
): Promise<ActionResult<{ taskId: string }>> {
  const user = await requireUser();
  return run(async () => {
    const { task } = await startAgentTest(db, getRunQueue(), user.id, agentId, input);
    revalidatePath(`/agent-builder/${agentId}`);
    revalidatePath("/tasks");
    return { taskId: task.id };
  });
}

// ---------------------------------------------------------------------------
// AI Command Center
// ---------------------------------------------------------------------------

export async function createCommandAction(
  input: CreateCommandInput,
): Promise<ActionResult<{ commandId: string }>> {
  const user = await requireUser();
  return run(async () => {
    const c = await createCommand(db, getRunQueue(), user.id, input);
    revalidatePath("/command");
    return { commandId: c.id };
  });
}

export async function dispatchWorkstreamsAction(
  commandId: string,
  input: DispatchInput,
): Promise<ActionResult<{ dispatched: number; awaitingApproval: number }>> {
  const user = await requireUser();
  return run(async () => {
    const r = await dispatchWorkstreams(db, getRunQueue(), user.id, commandId, input);
    revalidatePath(`/command/${commandId}`);
    revalidatePath("/tasks");
    revalidatePath("/approvals");
    return { dispatched: r.tasks.length, awaitingApproval: r.approvals.length };
  });
}

export async function decideApprovalAction(
  approvalId: string,
  input: DecideApprovalInput,
): Promise<ActionResult<{ status: string }>> {
  const user = await requireUser();
  return run(async () => {
    const r = await decideApproval(db, getRunQueue(), user.id, approvalId, input);
    revalidatePath("/approvals");
    revalidatePath(`/approvals/${approvalId}`);
    if (r.targetType === "command" && r.targetId) revalidatePath(`/command/${r.targetId}`);
    if (r.targetType === "workflow_run") revalidatePath("/workflows", "layout");
    if (r.targetType === "content_item") revalidatePath("/content", "layout");
    if (r.targetType === "campaign") revalidatePath("/marketing", "layout");
    revalidatePath("/calendar");
    return { status: r.status };
  });
}

export async function cancelApprovalAction(approvalId: string): Promise<ActionResult> {
  const user = await requireUser();
  return run(async () => {
    await cancelApproval(db, user.id, approvalId);
    revalidatePath("/approvals");
    revalidatePath("/workflows", "layout");
    revalidatePath("/content", "layout");
    revalidatePath("/marketing", "layout");
    revalidatePath(`/approvals/${approvalId}`);
    return undefined;
  });
}

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

export async function createWorkflowAction(
  input: WorkflowInput,
): Promise<ActionResult<{ workflowId: string }>> {
  const user = await requireUser();
  return run(async () => {
    const w = await createWorkflow(db, user.id, input);
    revalidatePath("/workflows");
    return { workflowId: w.id };
  });
}

export async function createWorkflowFromTemplateAction(
  businessId: string,
  templateKey: string,
): Promise<ActionResult<{ workflowId: string }>> {
  const user = await requireUser();
  return run(async () => {
    const w = await createWorkflowFromTemplate(db, user.id, businessId, templateKey);
    revalidatePath("/workflows");
    return { workflowId: w.id };
  });
}

export async function updateWorkflowAction(
  workflowId: string,
  expectedVersion: number,
  input: WorkflowInput,
): Promise<ActionResult<{ version: number }>> {
  const user = await requireUser();
  return run(async () => {
    const r = await updateWorkflow(db, user.id, workflowId, input, expectedVersion);
    revalidatePath("/workflows", "layout");
    return r;
  });
}

export async function setWorkflowStatusAction(
  workflowId: string,
  status: "active" | "disabled" | "archived",
): Promise<ActionResult> {
  const user = await requireUser();
  return run(async () => {
    await setWorkflowStatus(db, user.id, workflowId, status);
    revalidatePath("/workflows", "layout");
    return undefined;
  });
}

export async function startWorkflowRunAction(
  workflowId: string,
  input: StartWorkflowRunInput,
): Promise<ActionResult<{ runId: string }>> {
  const user = await requireUser();
  return run(async () => {
    const r = await startWorkflowRun(db, getRunQueue(), user.id, workflowId, input);
    revalidatePath(`/workflows/${workflowId}`);
    revalidatePath("/approvals");
    revalidatePath("/tasks");
    return { runId: r.id };
  });
}

export async function cancelWorkflowRunAction(runId: string): Promise<ActionResult> {
  const user = await requireUser();
  return run(async () => {
    await cancelWorkflowRun(db, getRunQueue(), user.id, runId);
    revalidatePath("/workflows", "layout");
    revalidatePath("/approvals");
    revalidatePath("/tasks", "layout");
    return undefined;
  });
}
