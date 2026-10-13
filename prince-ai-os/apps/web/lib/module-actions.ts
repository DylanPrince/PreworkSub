"use server";
import { revalidatePath } from "next/cache";
import {
  addBacklogItem,
  archiveContentItem,
  archiveProduct,
  archiveSupplier,
  askAgentAboutRecord,
  createCampaign,
  createContentItem,
  createFinanceEntry,
  createProduct,
  createSaasProject,
  createSupplier,
  endCampaign,
  markContentPublished,
  requestCampaignApproval,
  requestContentApproval,
  setBacklogStatus,
  setContentStage,
  subjectHref,
  updateCampaign,
  updateContentItem,
  updateProduct,
  updateSaasProject,
  voidFinanceEntry,
  type AskAgentInput,
  type BacklogItemInput,
  type CampaignInput,
  type ContentInput,
  type FinanceEntryInput,
  type ProductInput,
  type SaasProjectInput,
  type SupplierInput,
} from "@prince/core";
import type { BacklogStatus, ContentStage } from "@prince/database";
import { run, type ActionResult } from "./action-result";
import { db, getRunQueue } from "./server";
import { requireUser } from "./session";

/**
 * Server actions for the business modules. Validation and access checks live in @prince/core:
 * form values arrive as untyped data and each service parses them with its Zod schema.
 */
type FormInput = Record<string, unknown>;

// Finance -------------------------------------------------------------------

export async function createFinanceEntryAction(input: FormInput): Promise<ActionResult> {
  const user = await requireUser();
  return run(async () => {
    await createFinanceEntry(db, user.id, input as FinanceEntryInput);
    revalidatePath("/finance");
    revalidatePath("/");
    return undefined;
  });
}

export async function voidFinanceEntryAction(entryId: string): Promise<ActionResult> {
  const user = await requireUser();
  return run(async () => {
    await voidFinanceEntry(db, user.id, entryId);
    revalidatePath("/finance");
    return undefined;
  });
}

// E-commerce ----------------------------------------------------------------

export async function createProductAction(
  input: FormInput,
): Promise<ActionResult<{ productId: string }>> {
  const user = await requireUser();
  return run(async () => {
    const p = await createProduct(db, user.id, input as ProductInput);
    revalidatePath("/ecommerce");
    return { productId: p.id };
  });
}

export async function updateProductAction(
  productId: string,
  input: FormInput,
): Promise<ActionResult> {
  const user = await requireUser();
  return run(async () => {
    await updateProduct(db, user.id, productId, input as ProductInput);
    revalidatePath("/ecommerce", "layout");
    return undefined;
  });
}

export async function archiveProductAction(productId: string): Promise<ActionResult> {
  const user = await requireUser();
  return run(async () => {
    await archiveProduct(db, user.id, productId);
    revalidatePath("/ecommerce", "layout");
    return undefined;
  });
}

export async function createSupplierAction(input: FormInput): Promise<ActionResult> {
  const user = await requireUser();
  return run(async () => {
    await createSupplier(db, user.id, input as SupplierInput);
    revalidatePath("/ecommerce", "layout");
    return undefined;
  });
}

export async function archiveSupplierAction(supplierId: string): Promise<ActionResult> {
  const user = await requireUser();
  return run(async () => {
    await archiveSupplier(db, user.id, supplierId);
    revalidatePath("/ecommerce", "layout");
    return undefined;
  });
}

// Content -------------------------------------------------------------------

export async function createContentAction(
  input: FormInput,
): Promise<ActionResult<{ contentId: string }>> {
  const user = await requireUser();
  return run(async () => {
    const c = await createContentItem(db, user.id, input as ContentInput);
    revalidatePath("/content");
    return { contentId: c.id };
  });
}

export async function updateContentAction(id: string, input: FormInput): Promise<ActionResult> {
  const user = await requireUser();
  return run(async () => {
    await updateContentItem(db, user.id, id, input as ContentInput);
    revalidatePath("/content", "layout");
    revalidatePath("/approvals");
    return undefined;
  });
}

export async function setContentStageAction(
  id: string,
  stage: ContentStage,
): Promise<ActionResult> {
  const user = await requireUser();
  return run(async () => {
    await setContentStage(db, user.id, id, stage);
    revalidatePath("/content", "layout");
    return undefined;
  });
}

export async function requestContentApprovalAction(
  id: string,
  input: { scheduledFor?: string },
): Promise<ActionResult<{ approvalId: string }>> {
  const user = await requireUser();
  return run(async () => {
    const r = await requestContentApproval(db, user.id, id, input);
    revalidatePath("/content", "layout");
    revalidatePath("/approvals");
    return { approvalId: r.id };
  });
}

export async function markContentPublishedAction(
  id: string,
  input: { publishedUrl?: string },
): Promise<ActionResult> {
  const user = await requireUser();
  return run(async () => {
    await markContentPublished(db, user.id, id, input);
    revalidatePath("/content", "layout");
    return undefined;
  });
}

export async function archiveContentAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  return run(async () => {
    await archiveContentItem(db, user.id, id);
    revalidatePath("/content", "layout");
    revalidatePath("/approvals");
    return undefined;
  });
}

// Marketing -----------------------------------------------------------------

export async function createCampaignAction(
  input: FormInput,
): Promise<ActionResult<{ campaignId: string }>> {
  const user = await requireUser();
  return run(async () => {
    const c = await createCampaign(db, user.id, input as CampaignInput);
    revalidatePath("/marketing");
    return { campaignId: c.id };
  });
}

export async function updateCampaignAction(id: string, input: FormInput): Promise<ActionResult> {
  const user = await requireUser();
  return run(async () => {
    await updateCampaign(db, user.id, id, input as CampaignInput);
    revalidatePath("/marketing", "layout");
    revalidatePath("/approvals");
    return undefined;
  });
}

export async function requestCampaignApprovalAction(
  id: string,
): Promise<ActionResult<{ approvalId: string }>> {
  const user = await requireUser();
  return run(async () => {
    const r = await requestCampaignApproval(db, user.id, id);
    revalidatePath("/marketing", "layout");
    revalidatePath("/approvals");
    return { approvalId: r.id };
  });
}

export async function endCampaignAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  return run(async () => {
    await endCampaign(db, user.id, id);
    revalidatePath("/marketing", "layout");
    return undefined;
  });
}

// SaaS ----------------------------------------------------------------------

export async function createSaasProjectAction(
  input: FormInput,
): Promise<ActionResult<{ projectId: string }>> {
  const user = await requireUser();
  return run(async () => {
    const p = await createSaasProject(db, user.id, input as SaasProjectInput);
    revalidatePath("/saas");
    return { projectId: p.id };
  });
}

export async function updateSaasProjectAction(id: string, input: FormInput): Promise<ActionResult> {
  const user = await requireUser();
  return run(async () => {
    await updateSaasProject(db, user.id, id, input as SaasProjectInput);
    revalidatePath("/saas", "layout");
    return undefined;
  });
}

export async function addBacklogItemAction(
  projectId: string,
  input: FormInput,
): Promise<ActionResult> {
  const user = await requireUser();
  return run(async () => {
    await addBacklogItem(db, user.id, projectId, input as BacklogItemInput);
    revalidatePath(`/saas/${projectId}`);
    return undefined;
  });
}

export async function setBacklogStatusAction(
  itemId: string,
  status: BacklogStatus,
): Promise<ActionResult> {
  const user = await requireUser();
  return run(async () => {
    await setBacklogStatus(db, user.id, itemId, status);
    revalidatePath("/saas", "layout");
    return undefined;
  });
}

// Agents on records ---------------------------------------------------------

export async function askAgentAction(input: FormInput): Promise<ActionResult<{ taskId: string }>> {
  const user = await requireUser();
  return run(async () => {
    const { task } = await askAgentAboutRecord(db, getRunQueue(), user.id, input as AskAgentInput);
    const href = task.subjectId ? subjectHref(task.subjectType ?? "", task.subjectId) : null;
    if (href) revalidatePath(href.split("?")[0]!);
    revalidatePath("/tasks");
    revalidatePath("/research");
    return { taskId: task.id };
  });
}
