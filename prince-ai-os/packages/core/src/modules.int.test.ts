import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockProvider } from "@prince/ai";
import { createPrismaClient } from "@prince/database";
import {
  ForbiddenError,
  ValidationError,
  addBacklogItem,
  archiveProduct,
  askAgentAboutRecord,
  createBusiness,
  createCampaign,
  createContentItem,
  createFinanceEntry,
  createProduct,
  createSaasProject,
  createSupplier,
  decideApproval,
  endCampaign,
  executeRun,
  getAnalytics,
  getCalendar,
  getContentItem,
  getFinance,
  getOverview,
  getProduct,
  getSaasProject,
  listCampaigns,
  listEcommerce,
  listResearch,
  markContentPublished,
  productEconomics,
  requestCampaignApproval,
  requestContentApproval,
  setBacklogStatus,
  setContentStage,
  tasksAbout,
  updateCampaign,
  updateContentItem,
  updateProduct,
  voidFinanceEntry,
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

async function drain() {
  while (queue.jobs.length) {
    const job = queue.jobs.shift()!;
    await executeRun(deps, job.runId, { attempt: 1, maxAttempts: job.attempts });
  }
}

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  owner = await makeUser("mod-owner");
  member = await makeUser("mod-member");
  viewer = await makeUser("mod-viewer");
  outsider = await makeUser("mod-outsider");
  businessId = (await createBusiness(db, owner, { name: "Modules Co", goals: [] })).id;
  otherBusinessId = (await createBusiness(db, outsider, { name: "Other Co", goals: [] })).id;
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

describe("finance", () => {
  it("computes profit and loss from recorded entries with formulas, and voids entries", async () => {
    const entries = [
      ["revenue", 1000],
      ["refund", 100],
      ["other_income", 50],
      ["cogs", 300],
      ["operating_expense", 100],
      ["ad_spend", 200],
      ["subscription", 20],
      ["other_expense", 10],
    ] as const;
    for (const [kind, amountUsd] of entries)
      await createFinanceEntry(db, member, {
        businessId,
        kind,
        amountUsd,
        occurredOn: today(),
        description: `Test ${kind}`,
      });
    const { summary, entries: listed } = await getFinance(db, viewer, { businessId, days: 30 });
    expect(summary).toMatchObject({
      hasRevenue: true,
      netRevenue: 950,
      cogs: 300,
      grossProfit: 650,
      operatingExpenses: 330,
      netProfit: 320,
      entryCount: 8,
      sources: { user_entered: 8 },
    });
    expect(summary.grossMarginPercent).toBeCloseTo(68.42, 2);
    expect(summary.formulas.join(" ")).toMatch(/Net profit = gross profit − operating expenses/);
    expect(summary.alerts).toEqual([]);
    expect(listed.every((e) => e.canVoid === false)).toBe(true);

    const ad = (await getFinance(db, member, { businessId })).entries.find(
      (e) => e.kind === "ad_spend",
    )!;
    expect(ad.canVoid).toBe(true);
    await expect(voidFinanceEntry(db, viewer, ad.id)).rejects.toBeInstanceOf(ForbiddenError);
    await voidFinanceEntry(db, member, ad.id);
    await expect(voidFinanceEntry(db, member, ad.id)).rejects.toThrow(/already voided/);
    const after = (await getFinance(db, owner, { businessId })).summary;
    expect(after).toMatchObject({ operatingExpenses: 130, netProfit: 520 });
    expect(
      await db.auditEvent.count({ where: { action: "finance.entry_voided", targetId: ad.id } }),
    ).toBe(1);

    const overview = await getOverview(db, owner, { businessId, days: 7 });
    expect(overview.finance).toMatchObject({ netRevenue: 950, netProfit: 520 });
  });

  it("validates entries, enforces roles and scopes reads", async () => {
    const base = {
      businessId,
      kind: "revenue" as const,
      amountUsd: 10,
      occurredOn: today(),
      description: "Sale",
    };
    await expect(createFinanceEntry(db, viewer, base)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createFinanceEntry(db, outsider, base)).rejects.toBeInstanceOf(ForbiddenError);
    for (const bad of [
      { amountUsd: -5 },
      { amountUsd: 0 },
      { occurredOn: "13/10/2026" },
      { kind: "salary" },
      { description: "" },
    ]) {
      await expect(
        createFinanceEntry(db, member, { ...base, ...bad } as never),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    const other = await getFinance(db, outsider);
    expect(other.entries.some((e) => e.businessId === businessId)).toBe(false);
  });

  it("flags negative margins and reports no revenue as untracked", async () => {
    const b = (await createBusiness(db, owner, { name: "Loss Co", goals: [] })).id;
    expect((await getFinance(db, owner, { businessId: b })).summary).toMatchObject({
      hasRevenue: false,
      alerts: [],
    });
    await createFinanceEntry(db, owner, {
      businessId: b,
      kind: "revenue",
      amountUsd: 100,
      occurredOn: today(),
      description: "Sale",
    });
    await createFinanceEntry(db, owner, {
      businessId: b,
      kind: "cogs",
      amountUsd: 150,
      occurredOn: today(),
      description: "Stock",
    });
    const { summary } = await getFinance(db, owner, { businessId: b });
    expect(summary.alerts.join(" ")).toMatch(/Gross profit is negative/);
    expect(summary.alerts.join(" ")).toMatch(/Net profit is negative/);
  });
});

describe("e-commerce", () => {
  it("calculates unit economics with formulas and reports missing figures", () => {
    const e = productEconomics({
      priceUsd: 40,
      unitCostUsd: 12,
      shippingCostUsd: 5,
      feePercent: 3,
      feeFixedUsd: 0.3,
    });
    expect(e).toMatchObject({
      missing: [],
      feeUsd: 1.5,
      landedCostUsd: 18.5,
      profitPerUnitUsd: 21.5,
      marginPercent: 53.75,
      breakEvenRoas: 1.86,
    });
    expect(e.formulas[0]).toBe("Fees = 40.00 × 3.00% + 0.30 = 1.50");
    expect(
      productEconomics({
        priceUsd: null,
        unitCostUsd: 3,
        shippingCostUsd: null,
        feePercent: null,
        feeFixedUsd: null,
      }),
    ).toMatchObject({ missing: ["price"], marginPercent: null, formulas: [] });
    expect(
      productEconomics({
        priceUsd: 10,
        unitCostUsd: 3,
        shippingCostUsd: null,
        feePercent: null,
        feeFixedUsd: null,
      }).missing,
    ).toEqual(["shipping (counted as 0)", "fees (counted as 0)"]);
  });

  it("stores products and suppliers per business with audited changes", async () => {
    const supplier = await createSupplier(db, member, {
      businessId,
      name: "Bamboo Works",
      website: "https://example.com",
      leadTimeDays: 21,
      minimumOrder: 500,
    });
    await expect(
      createSupplier(db, member, { businessId, name: "Bad", website: "ftp://x" }),
    ).rejects.toThrow(/Check the highlighted fields/);
    const foreign = await createSupplier(db, outsider, {
      businessId: otherBusinessId,
      name: "Elsewhere Supply",
    });
    const input = {
      businessId,
      name: "Bamboo toothbrush 4-pack",
      priceUsd: "40",
      unitCostUsd: "12",
      shippingCostUsd: "",
      feePercent: "3",
      feeFixedUsd: "0.3",
      supplierId: supplier.id,
    };
    await expect(createProduct(db, member, { ...input, supplierId: foreign.id })).rejects.toThrow(
      /Check the highlighted fields/,
    );
    await expect(createProduct(db, viewer, input)).rejects.toBeInstanceOf(ForbiddenError);
    const product = await createProduct(db, member, input);
    expect(product.shippingCostUsd).toBeNull();

    const view = await getProduct(db, viewer, product.id);
    expect(view.canEdit).toBe(false);
    expect(view.product.economics).toMatchObject({ profitPerUnitUsd: 26.5 });
    expect(view.product.supplier?.name).toBe("Bamboo Works");
    await expect(getProduct(db, outsider, product.id)).rejects.toBeInstanceOf(ForbiddenError);

    await updateProduct(db, member, product.id, {
      ...input,
      shippingCostUsd: "5",
      stage: "sourcing",
    });
    const audit = await db.auditEvent.findFirstOrThrow({
      where: { action: "product.updated", targetId: product.id },
    });
    expect(audit.summary).toMatch(/stage/);
    expect(audit.summary).toMatch(/shippingCostUsd/);
    expect(audit.summary).not.toMatch(/priceUsd/);

    const listed = await listEcommerce(db, owner, { businessId });
    expect(listed.products.find((p) => p.id === product.id)?.economics.marginPercent).toBe(53.75);
    expect(listed.suppliers.find((s) => s.id === supplier.id)?._count.products).toBe(1);
    await archiveProduct(db, member, product.id);
    expect(
      (await listEcommerce(db, owner, { businessId })).products.some((p) => p.id === product.id),
    ).toBe(false);
  });
});

describe("content studio", () => {
  async function inReview() {
    const item = await createContentItem(db, member, {
      businessId,
      title: `Launch post ${crypto.randomUUID().slice(0, 6)}`,
      format: "social_post",
      channel: "Instagram",
      brief: "Announce the refillable toothbrush",
      body: "Meet the toothbrush you refill, not replace.",
    });
    await setContentStage(db, member, item.id, "review");
    return item;
  }

  it("approves exact text for publication through the approval system", async () => {
    const item = await inReview();
    await expect(setContentStage(db, member, item.id, "approved")).rejects.toThrow(
      /Request approval/,
    );
    const request = await requestContentApproval(db, member, item.id, {
      scheduledFor: inDays(3),
    });
    expect(request).toMatchObject({
      category: "publish",
      status: "pending",
      requestedById: member,
    });
    expect(request.summary).toMatch(/will not post it/);
    expect(
      (await requestContentApproval(db, member, item.id, { scheduledFor: inDays(3) })).id,
    ).toBe(request.id);
    await expect(
      decideApproval(db, queue, member, request.id, { decision: "approve" }, policy()),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const decided = await decideApproval(
      db,
      queue,
      owner,
      request.id,
      { decision: "approve" },
      policy(),
    );
    expect(decided.status).toBe("executed");
    const { item: approved } = await getContentItem(db, viewer, item.id);
    expect(approved.stage).toBe("approved");
    expect(approved.scheduledFor?.toISOString().slice(0, 10)).toBe(inDays(3));

    // Calendar shows the planned date.
    const cal = await getCalendar(db, viewer, { month: inDays(3).slice(0, 7), businessId });
    expect(cal.events).toContainEqual(
      expect.objectContaining({ kind: "content", href: `/content/${item.id}`, status: "approved" }),
    );

    // Editing the approved text sends it back to drafting.
    await updateContentItem(db, member, item.id, {
      businessId,
      title: approved.title,
      format: "social_post",
      channel: "Instagram",
      body: "Changed after approval.",
    });
    expect((await getContentItem(db, owner, item.id)).item).toMatchObject({
      stage: "drafting",
      scheduledFor: null,
    });
    await expect(markContentPublished(db, member, item.id, {})).rejects.toThrow(/Only approved/);
  });

  it("withdraws a pending request when the text changes, and blocks a rejected text", async () => {
    const item = await inReview();
    const first = await requestContentApproval(db, member, item.id, {});
    await updateContentItem(db, member, item.id, {
      businessId,
      title: item.title,
      format: "social_post",
      body: "A new draft",
    });
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: first.id } })).status).toBe(
      "cancelled",
    );
    const second = await requestContentApproval(db, member, item.id, {});
    await decideApproval(
      db,
      queue,
      owner,
      second.id,
      { decision: "reject", note: "Off brand" },
      policy(),
    );
    expect((await getContentItem(db, owner, item.id)).item.stage).toBe("review");
    await expect(requestContentApproval(db, member, item.id, {})).rejects.toThrow(/was rejected/);
  });

  it("records manual publication only after approval, then freezes the item", async () => {
    const item = await inReview();
    const request = await requestContentApproval(db, member, item.id, {});
    await decideApproval(db, queue, owner, request.id, { decision: "approve" }, policy());
    await expect(
      markContentPublished(db, member, item.id, { publishedUrl: "not a url" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await markContentPublished(db, member, item.id, { publishedUrl: "https://example.com/p/1" });
    const { item: published } = await getContentItem(db, owner, item.id);
    expect(published).toMatchObject({
      stage: "published",
      publishedUrl: "https://example.com/p/1",
    });
    await expect(
      updateContentItem(db, member, item.id, { businessId, title: "x", format: "other" }),
    ).rejects.toThrow(/cannot be edited/);
    await expect(setContentStage(db, member, item.id, "idea")).rejects.toThrow(/cannot change/);
  });

  it("fails an approval when the text changed by other means", async () => {
    const item = await inReview();
    const request = await requestContentApproval(db, member, item.id, {});
    await db.contentItem.update({ where: { id: item.id }, data: { body: "Sneaky edit" } });
    const decided = await decideApproval(
      db,
      queue,
      owner,
      request.id,
      { decision: "approve" },
      policy(),
    );
    expect(decided.status).toBe("failed");
    expect(decided.errorMessage).toMatch(/content changed/);
    expect((await getContentItem(db, owner, item.id)).item.stage).toBe("review");
  });
});

describe("marketing", () => {
  const campaign = (over: Record<string, unknown> = {}) => ({
    businessId,
    name: `Spring push ${crypto.randomUUID().slice(0, 6)}`,
    objective: "Get the first 100 subscribers",
    channels: "Meta, Google",
    budgetUsd: "250",
    startsOn: inDays(5),
    endsOn: inDays(20),
    ...over,
  });

  it("needs complete terms, then approval for the exact budget and dates", async () => {
    await expect(createCampaign(db, member, campaign({ endsOn: inDays(1) }))).rejects.toThrow(
      /Check the highlighted fields/,
    );
    const draft = await createCampaign(db, member, campaign({ budgetUsd: "", startsOn: "" }));
    await expect(requestCampaignApproval(db, member, draft.id)).rejects.toThrow(
      /Add a budget, a start date/,
    );
    const c = await createCampaign(db, member, campaign());
    expect(c.channels).toEqual(["Meta", "Google"]);
    const request = await requestCampaignApproval(db, member, c.id);
    expect(request).toMatchObject({ category: "spend", status: "pending" });
    expect(Number(request.estimatedCostUsd)).toBe(250);
    expect(request.summary).toMatch(/will not launch it or spend anything/);

    const decided = await decideApproval(
      db,
      queue,
      owner,
      request.id,
      { decision: "approve" },
      policy(),
    );
    expect(decided.status).toBe("executed");
    expect(
      (await listCampaigns(db, viewer, { businessId })).find((x) => x.id === c.id),
    ).toMatchObject({
      status: "approved",
      budgetUsd: 250,
      pendingApprovalId: null,
    });

    // Raising the budget after approval needs a new approval.
    await updateCampaign(db, member, c.id, campaign({ name: c.name, budgetUsd: "400" }));
    expect((await db.campaign.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("planning");
    // A zero budget publishes but spends nothing.
    const free = await createCampaign(db, member, campaign({ budgetUsd: "0" }));
    expect((await requestCampaignApproval(db, member, free.id)).category).toBe("publish");

    await endCampaign(db, member, c.id);
    await expect(updateCampaign(db, member, c.id, campaign())).rejects.toThrow(/Ended/);
  });

  it("fails an approval whose terms changed by other means", async () => {
    const c = await createCampaign(db, member, campaign());
    const request = await requestCampaignApproval(db, member, c.id);
    await db.campaign.update({ where: { id: c.id }, data: { budgetUsd: 9999 } });
    const decided = await decideApproval(
      db,
      queue,
      owner,
      request.id,
      { decision: "approve" },
      policy(),
    );
    expect(decided).toMatchObject({ status: "failed" });
    expect(decided.errorMessage).toMatch(/budget, dates or channels changed/);
    const cal = await getCalendar(db, owner, { month: inDays(5).slice(0, 7), businessId });
    expect(
      cal.events.some((e) => e.kind === "campaign_start" && e.href === `/marketing/${c.id}`),
    ).toBe(true);
  });
});

describe("SaaS projects", () => {
  it("keeps requirements and a prioritised backlog", async () => {
    await expect(
      createSaasProject(db, viewer, { businessId, name: "Portal" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const p = await createSaasProject(db, member, {
      businessId,
      name: "Subscriber portal",
      requirements: "Customers manage refills.",
      repositoryUrl: "https://github.com/example/portal",
    });
    await addBacklogItem(db, member, p.id, { title: "Login", priority: "low" });
    const bug = await addBacklogItem(db, member, p.id, {
      title: "Refill date off by one",
      type: "bug",
      priority: "high",
    });
    await expect(addBacklogItem(db, viewer, p.id, { title: "Nope" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await setBacklogStatus(db, member, bug.id, "in_progress");
    const view = await getSaasProject(db, viewer, p.id);
    expect(view.project.items.map((i) => [i.title, i.status])).toEqual([
      ["Refill date off by one", "in_progress"],
      ["Login", "todo"],
    ]);
    expect(view.canEdit).toBe(false);
  });
});

describe("asking agents about records", () => {
  it("creates a linked task with the record as context and lists it on the record", async () => {
    const product = await createProduct(db, member, {
      businessId,
      name: "Charcoal floss",
      priceUsd: 8,
      unitCostUsd: 2,
    });
    const agent = await db.agent.findFirstOrThrow({
      where: { templateKey: "financial-analyst", businessId: null },
    });
    const ask = {
      subjectType: "product" as const,
      subjectId: product.id,
      agentId: agent.id,
      instructions: "Check whether this product can be profitable with paid ads.",
      provider: "mock" as const,
      idempotencyKey: crypto.randomUUID(),
    };
    await expect(askAgentAboutRecord(db, queue, viewer, ask, policy())).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(askAgentAboutRecord(db, queue, outsider, ask, policy())).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const { task, run } = await askAgentAboutRecord(db, queue, member, ask, policy());
    expect(task).toMatchObject({ subjectType: "product", subjectId: product.id, businessId });
    expect(task.instructions).toContain("Product: Charcoal floss");
    expect(task.instructions).toContain("Profit per unit = price 8.00 − landed cost 2.00 = 6.00");
    expect(run?.provider).toBe("mock");
    await drain();
    const related = await tasksAbout(db, "product", product.id);
    expect(related).toEqual([
      expect.objectContaining({ id: task.id, status: "succeeded", provider: "mock" }),
    ]);

    const finance = await askAgentAboutRecord(
      db,
      queue,
      member,
      {
        ...ask,
        subjectType: "finance",
        subjectId: businessId,
        idempotencyKey: crypto.randomUUID(),
      },
      policy(),
    );
    expect(finance.task.instructions).toMatch(/Net profit \$/);
    await expect(
      askAgentAboutRecord(
        db,
        queue,
        member,
        {
          ...ask,
          subjectType: "finance",
          subjectId: otherBusinessId,
          idempotencyKey: crypto.randomUUID(),
        },
        policy(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("insight views", () => {
  it("lists research briefs, analytics and calendar entries from real records only", async () => {
    const fresh = await createBusiness(db, owner, { name: "Empty Co", goals: [] });
    expect(await listResearch(db, owner, { businessId: fresh.id })).toEqual([]);
    const empty = await getAnalytics(db, owner, { businessId: fresh.id });
    expect(empty).toMatchObject({ agentUtilization: [], workflowStats: [], totals: { runs: 0 } });
    expect(empty.monthly.every((m) => m.entries === 0 && m.netProfit === 0)).toBe(true);

    const agent = await db.agent.findFirstOrThrow({
      where: { templateKey: "market-research", businessId: null },
    });
    const product = await createProduct(db, owner, { businessId: fresh.id, name: "Bamboo comb" });
    await askAgentAboutRecord(
      db,
      queue,
      owner,
      {
        subjectType: "product",
        subjectId: product.id,
        agentId: agent.id,
        instructions: "Who buys bamboo combs and why?",
        provider: "mock",
        idempotencyKey: crypto.randomUUID(),
      },
      policy(),
    );
    await drain();
    const research = await listResearch(db, owner, { businessId: fresh.id });
    expect(research).toHaveLength(1);
    expect(research[0]).toMatchObject({ provider: "mock", findings: 1, needsVerification: 1 });
    expect(await listResearch(db, outsider)).not.toContainEqual(
      expect.objectContaining({ runId: research[0]!.runId }),
    );

    const analytics = await getAnalytics(db, owner, { businessId: fresh.id });
    expect(analytics.agentUtilization).toEqual([
      expect.objectContaining({
        agent: "Market Research Agent",
        runs: 1,
        succeeded: 1,
        mockRuns: 1,
        successRate: 1,
      }),
    ]);
    expect(analytics.pipelines.products).toEqual({ idea: 1 });
    expect(analytics.perBusiness).toEqual([
      expect.objectContaining({ business: "Empty Co", runs: 1, hasRevenue: false }),
    ]);
  });
});
