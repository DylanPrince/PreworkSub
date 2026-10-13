import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const email = `owner+${Date.now()}@example.com`;
const password = "correct-horse-battery-staple";

async function signUp(page: Page) {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Test Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
}

let session: Awaited<ReturnType<BrowserContext["cookies"]>> | undefined;

/**
 * Signs in through the form once, then reuses that session: the auth rate limit on sign-in
 * (a real protection) would otherwise refuse the rapid repeated sign-ins of a test run.
 */
async function signIn(page: Page) {
  if (session) {
    await page.context().addCookies(session);
    await page.goto("/");
  } else {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  session = await page.context().cookies();
}

test.describe.serial("first vertical slice", () => {
  test("unauthenticated users are redirected to sign in", async ({ page }) => {
    await page.goto("/tasks");
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test("owner signs up, creates a business, runs an agent, and sees persisted history", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));

    await signUp(page);
    await expect(page.getByText("Mock mode is the default")).toBeVisible();
    await expect(page.getByRole("link", { name: /AI status: Mock mode/ })).toBeVisible();

    // Business workspace
    await page.getByRole("link", { name: "Businesses" }).first().click();
    await page.getByRole("link", { name: /New business/ }).click();
    await page.getByLabel("Name").fill("Acme Outdoor Goods");
    await page.getByLabel("Business model").fill("DTC e-commerce");
    await page.getByLabel("Goals (one per line)").fill("Validate 3 product ideas");
    await page.getByRole("button", { name: "Create business" }).click();
    await expect(page.getByRole("heading", { name: "Acme Outdoor Goods" })).toBeVisible();

    // Validation errors are shown, not swallowed
    await page.getByRole("link", { name: /New task/ }).click();
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(page.getByText("Title must be at least 3 characters")).toBeVisible();

    // Task creation + immediate run on the mock provider
    await page
      .getByLabel("Agent", { exact: true })
      .selectOption({ label: "Market Research Agent" });
    await page.getByLabel("Title").fill("Research camping gear niches");
    await page
      .getByLabel("Instructions")
      .fill("Identify promising camping gear niches for a small DTC brand.");
    await page.getByRole("button", { name: "Create task" }).click();

    const latest = page.getByRole("region", { name: "Latest run" });
    await expect(latest.getByText("succeeded", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(latest.getByText("Mock output", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Agent output" })).toContainText("MOCK OUTPUT");

    // History persists across reloads and appears in agent + activity views
    await page.reload();
    await expect(latest.getByText("succeeded", { exact: true }).first()).toBeVisible();
    await page.getByRole("link", { name: /View Market Research Agent configuration/ }).click();
    await expect(page.getByRole("cell", { name: "Research camping gear niches" })).toBeVisible();
    await page.goto("/activity");
    await expect(page.getByRole("cell", { name: "run.succeeded" })).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });

  test("a failing run records the error and can be retried", async ({ page }) => {
    await signIn(page);
    await page.goto("/tasks/new");
    await page.getByLabel("Agent", { exact: true }).selectOption({ label: "Financial Analyst" });
    await page.getByLabel("Title").fill("Margin check");
    await page
      .getByLabel("Instructions")
      .fill("Compute margins. [mock:fail] simulates a provider error.");
    await page.getByRole("button", { name: "Create task" }).click();
    const latest = page.getByRole("region", { name: "Latest run" });
    await expect(latest.getByText("failed", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(latest.getByRole("alert")).toContainText("simulated failure");
    await latest.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByRole("region", { name: /Earlier run/ })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("owner builds, dry-runs and versions a custom agent", async ({ page }) => {
    await signIn(page);
    await page.goto("/agent-builder");
    await page.getByRole("link", { name: "New agent" }).click();

    // Server-side validation is surfaced per field
    await page.getByRole("button", { name: "Create agent" }).click();
    await expect(page.getByText("Name must be at least 3 characters")).toBeVisible();

    await page.getByLabel("Name", { exact: true }).fill("Pricing Reviewer");
    await page.getByLabel("Division").selectOption("Business Operations");
    await page.getByLabel("Specialization").fill("Pricing review");
    await page.getByLabel("Description").fill("Reviews pricing pages and suggests improvements.");
    await page
      .getByLabel("Instructions (system prompt)")
      .fill("You review pricing for this business. Explain each suggestion and flag missing data.");
    await page.getByRole("button", { name: "Create agent" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Pricing Reviewer" })).toBeVisible();

    // No API key in this environment: paid tests are disabled with an explanation
    await expect(page.getByRole("button", { name: "Test with Claude" })).toBeDisabled();
    await expect(
      page.getByText(/Claude is not configured on the server yet/).first(),
    ).toBeVisible();

    await page.getByLabel("Sample task").fill("Review the pricing of our two-person tent.");
    await page.getByRole("button", { name: "Dry run (mock)" }).click();
    const latest = page.getByRole("region", { name: "Latest run" });
    await expect(latest.getByText("succeeded", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(latest.getByTitle(/Generated locally without an AI model/)).toHaveText(
      "Mock output",
    );
    await expect(page.getByRole("region", { name: "Agent output" })).toContainText("MOCK OUTPUT");

    // Editing saves a new immutable version
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: "Pricing Reviewer" })).toBeVisible();
    await page.getByLabel("Max output tokens").fill("1024");
    await page.getByLabel("Change note (optional)").fill("Shorter reports");
    await page.getByRole("button", { name: "Save as v2" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Saved as a new version." }),
    ).toBeVisible();
    await expect(page.getByText(/Shorter reports/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Save as v3" })).toBeVisible();
  });

  test("owner plans a request in the Command Center and dispatches workstreams in order", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/command");
    await page
      .getByLabel("What do you want to achieve?")
      .fill("Launch a lightweight camping stove line this quarter.");
    // No API key here: planning with Claude is unavailable, the free dry run is not.
    await expect(page.getByRole("button", { name: "Plan with Claude" })).toBeDisabled();
    await page.getByRole("button", { name: "Dry run (mock)" }).click();

    const plan = page.getByRole("region", { name: "Plan" });
    await expect(plan.getByText("succeeded", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(plan.getByText(/came from the mock provider/)).toBeVisible();

    const workstreams = page.getByRole("region", { name: "Workstreams" });
    const item = (title: string) =>
      workstreams.getByRole("listitem").filter({ has: page.getByText(title, { exact: true }) });
    const research = item("Research");
    const finance = item("Financial check");
    const launch = item("Launch copy");
    await expect(research.getByRole("checkbox")).toBeChecked();
    await expect(finance.getByText("Waiting on Research")).toBeVisible();
    await expect(workstreams.getByRole("button", { name: "Dispatch with Claude" })).toBeDisabled();

    await workstreams.getByRole("button", { name: "Dispatch as dry run" }).click();
    await expect(research.getByText("succeeded", { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    // Research finished, so the dependent workstream unlocks with a suggested agent.
    await expect(finance.getByRole("combobox", { name: "Agent for Financial check" })).toHaveValue(
      /.+/,
    );
    await workstreams.getByRole("button", { name: "Dispatch as dry run" }).click();
    await expect(finance.getByText("succeeded", { exact: true })).toBeVisible({ timeout: 30_000 });

    // The plan flagged "Launch copy" for owner approval: it goes to Approvals instead of starting.
    await expect(launch.getByText("Owner approval flagged")).toBeVisible();
    await expect(launch.getByRole("checkbox")).not.toBeChecked();
    await launch.getByRole("checkbox").check();
    await expect(workstreams.getByText(/will go to Approvals instead of starting/)).toBeVisible();
    await workstreams.getByRole("button", { name: "Dispatch as dry run" }).click();
    await expect(launch.getByText("Awaiting approval")).toBeVisible();
    await expect(launch.getByRole("link", { name: /task/ })).toHaveCount(0);

    // The overview counts it, and the owner approves it on its own page.
    await page.goto("/");
    await page.getByRole("link", { name: /1 approval request\(s\) waiting/ }).click();
    const queue = page.getByRole("region", { name: "Waiting for a decision" });
    await queue.getByRole("link", { name: 'Run "Launch copy" with Copywriting Agent' }).click();
    await expect(
      page.getByText(/plan marks this workstream as needing owner approval/),
    ).toBeVisible();
    await page.getByLabel("Note (optional)").fill("Fine as a draft");
    await page.getByRole("button", { name: "Approve and run" }).click();
    const decision = page.getByRole("region", { name: "Decision" });
    await expect(decision.getByText("Approved · carried out").first()).toBeVisible();
    await expect(decision.getByText("Fine as a draft")).toBeVisible();
    await decision.getByRole("link", { name: "open the task" }).click();
    await expect(
      page
        .getByRole("region", { name: "Latest run" })
        .getByText("succeeded", { exact: true })
        .first(),
    ).toBeVisible({ timeout: 30_000 });

    // The approved workstream ran, and the dependent task received the earlier result as context.
    await page.getByRole("link", { name: /Command Center request/ }).click();
    await expect(launch.getByText("succeeded", { exact: true })).toBeVisible({ timeout: 30_000 });
    await finance.getByRole("link", { name: /Financial Analyst task/ }).click();
    await expect(page.getByText(/Result of the earlier workstream "Research"/)).toBeVisible();
  });

  test("owner runs a workflow template as a dry run and approves its gated step", async ({
    page,
  }) => {
    await signIn(page);
    await page.getByRole("link", { name: "Workflows" }).first().click();
    await page.getByRole("button", { name: "Use template: Product idea validation" }).click();
    await expect(page.getByRole("heading", { name: "Product idea validation" })).toBeVisible();
    const steps = page.getByRole("region", { name: "Steps" });
    await expect(steps.getByText("Needs approval")).toHaveCount(1);

    // Validation is enforced on the server and shown next to the field.
    await page.getByRole("button", { name: "Dry run (mock)" }).click();
    await expect(page.getByText("Describe what this run should work on")).toBeVisible();
    await page.getByLabel("Input for this run").fill("A refillable bamboo toothbrush subscription");
    await page.getByRole("button", { name: "Dry run (mock)" }).click();
    await expect(
      page.getByRole("heading", { name: "Run of Product idea validation" }),
    ).toBeVisible();

    const progress = page.getByRole("region", { name: "Step progress" });
    const stepItem = (title: string) => progress.getByRole("listitem", { name: title });
    await expect(stepItem("Unit economics").getByText("succeeded", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(stepItem("Market research").getByText("succeeded", { exact: true })).toBeVisible();
    // The gated step did not start: it waits in the Approvals queue.
    await expect(page.getByText("A step is waiting for approval")).toBeVisible();
    await expect(stepItem("Launch copy").getByText("Open result")).toHaveCount(0);
    await stepItem("Launch copy").getByRole("link", { name: "Waiting for decision" }).click();

    await expect(page.getByText(/The agent produces analysis and drafts only/)).toBeVisible();
    await page.getByRole("button", { name: "Approve and run" }).click();
    const decision = page.getByRole("region", { name: "Decision" });
    await expect(decision.getByText("Approved · carried out").first()).toBeVisible();
    await page.getByRole("link", { name: "Workflow run" }).click();
    await expect(stepItem("Launch copy").getByText("succeeded", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Run of Product idea validation" }),
    ).toBeVisible();
    await expect(page.getByText("succeeded", { exact: true }).first()).toBeVisible();

    // Each step received the results of the steps it waited for.
    await stepItem("Unit economics").getByRole("link", { name: "Open result" }).click();
    await expect(page.getByText(/Result of the earlier step "Market research"/)).toBeVisible();
  });

  test("owner runs the business modules, with approval before publishing or spending", async ({
    page,
  }) => {
    await signIn(page);
    page.on("dialog", (d) => d.accept());
    const nav = page.getByRole("navigation", { name: "Main" });
    const today = new Date().toISOString().slice(0, 10);

    // Finance: revenue is "not tracked" until recorded; profit follows the entries.
    await nav.getByRole("link", { name: "Finance" }).click();
    await expect(page.getByRole("heading", { name: "Finance", level: 1 })).toBeVisible();
    await expect(page.getByText("Not tracked yet").first()).toBeVisible();
    const fin = page.getByRole("form", { name: "New finance entry" });
    await fin.getByRole("button", { name: "Add entry" }).click();
    await expect(fin.getByText("Enter an amount above zero")).toBeVisible();
    for (const [kind, amount, description] of [
      ["Revenue", "1200", "October sales"],
      ["Cost of goods sold", "400", "Inventory restock"],
      ["Ad spend", "150", "Meta ads week 41"],
    ]) {
      await fin.getByLabel("Type").selectOption({ label: kind! });
      await fin.getByLabel("Amount (USD)").fill(amount!);
      await fin.getByLabel("Description").fill(description!);
      await fin.getByRole("button", { name: "Add entry" }).click();
      await expect(page.getByRole("cell", { name: new RegExp(`^${description}`) })).toBeVisible();
    }
    const netProfit = page.getByRole("row", { name: /Net profit/ });
    await expect(netProfit).toContainText("$650.00");
    await page.getByRole("button", { name: "Void Meta ads week 41" }).click();
    await expect(page.getByText("Voided")).toBeVisible();
    await expect(netProfit).toContainText("$800.00");

    // E-commerce: unit economics with the formulas shown, and an agent asked about the product.
    await nav.getByRole("link", { name: "E-commerce" }).click();
    const product = page.getByRole("form", { name: "New product" });
    await product.getByLabel("Product name").fill("Trail Bottle");
    await product.getByLabel("Selling price").fill("40");
    await product.getByLabel("Unit cost").fill("12");
    await product.getByLabel("Shipping per unit").fill("5");
    await product.getByLabel("Payment/platform fee (%)").fill("3");
    await product.getByLabel("Fixed fee per order").fill("0.30");
    await product.getByRole("button", { name: "Add product" }).click();
    await expect(page.getByRole("heading", { name: "Trail Bottle", level: 1 })).toBeVisible();
    const economics = page.getByRole("region", { name: "Unit economics" });
    await expect(economics.getByText("$21.50")).toBeVisible();
    await expect(page.getByText("Fees = 40.00 × 3.00% + 0.30 = 1.50")).toBeVisible();
    await page.getByRole("button", { name: "Dry run (mock)" }).click();
    await expect(page).toHaveURL(/\/tasks\//);
    await expect(page.getByText("succeeded", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await page.goBack();
    await page.reload();
    await expect(page.getByRole("link", { name: /\(Trail Bottle\)$/ })).toBeVisible();

    // Content: review, approval of the exact text, then a person records publication.
    await nav.getByRole("link", { name: "Content Studio" }).click();
    const idea = page.getByRole("form", { name: "New content item" });
    await idea.getByLabel("Title").fill("Autumn trail guide");
    await idea.getByLabel("Channel").fill("Blog");
    await idea.getByRole("button", { name: "Add idea" }).click();
    await expect(page.getByRole("heading", { name: "Autumn trail guide", level: 1 })).toBeVisible();
    const edit = page.getByRole("form", { name: "Edit content" });
    await edit.getByLabel("Text to publish").fill("Autumn is the best time to hike.");
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(edit.getByText("Saved.")).toBeVisible();
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page.getByLabel("Planned publication date (optional)").fill(today);
    await page.getByRole("button", { name: "Request approval" }).click();
    await page.getByRole("link", { name: "Open the approval request" }).click();
    await expect(page.getByText(/Prince AI OS will not post it/)).toBeVisible();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    const decision = page.getByRole("region", { name: "Decision" });
    await expect(decision.getByText("Approved · carried out").first()).toBeVisible();
    await page.getByRole("link", { name: "Content item" }).click();
    await expect(page.getByText(`Approved for publication on ${today}`)).toBeVisible();
    await page.getByLabel("Link to the published item (optional)").fill("https://example.com/a");
    await page.getByRole("button", { name: "Mark as published" }).click();
    await expect(page.getByText(/Published items are kept as a record/)).toBeVisible();

    // Marketing: launch approval covers the budget; nothing is launched or spent.
    await nav.getByRole("link", { name: "Marketing" }).click();
    const plan = page.getByRole("form", { name: "New campaign" });
    await plan.getByLabel("Campaign name").fill("Autumn launch");
    await plan.getByLabel("Objective").fill("Sell 200 Trail Bottles");
    await plan.getByLabel("Channels").fill("Meta ads, Google search");
    await plan.getByLabel("Planned budget (USD)").fill("300");
    await plan.getByLabel("Start date").fill(today);
    await plan.getByRole("button", { name: "Plan campaign" }).click();
    await expect(page.getByRole("heading", { name: "Autumn launch", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Request launch approval" }).click();
    await page.getByRole("link", { name: "Open the approval request" }).click();
    await expect(page.getByText(/will not launch it or spend anything/)).toBeVisible();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(decision.getByText("Approved · carried out").first()).toBeVisible();
    await page.getByRole("link", { name: "Campaign" }).click();
    await expect(page.getByText(/Prince AI OS does not launch it or spend anything/)).toBeVisible();

    // SaaS: a prioritised backlog.
    await nav.getByRole("link", { name: "SaaS Projects" }).click();
    const project = page.getByRole("form", { name: "New software project" });
    await project.getByLabel("Project name").fill("Route planner");
    await project.getByRole("button", { name: "Add project" }).click();
    await expect(page.getByRole("heading", { name: "Route planner", level: 1 })).toBeVisible();
    const backlog = page.getByRole("form", { name: "New backlog item" });
    await backlog.getByLabel("Title").fill("Weather API integration");
    await backlog.getByRole("button", { name: "Add to backlog" }).click();
    await page.getByLabel("Status of Weather API integration").selectOption("in_progress");
    await expect(page.getByRole("region", { name: "In progress" })).toBeVisible();

    // Dated records reach the calendar; analytics count the pipelines.
    await nav.getByRole("link", { name: "Calendar" }).click();
    await expect(page.getByRole("link", { name: "Publish: Autumn trail guide" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Campaign starts: Autumn launch" })).toBeVisible();
    await nav.getByRole("link", { name: "Analytics" }).click();
    await expect(page.getByRole("heading", { name: "Agent utilization" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Market Research Agent" })).toBeVisible();
  });

  test("every sidebar page renders in light and dark mode", async ({ page }) => {
    await signIn(page);
    const links = await page.getByRole("navigation", { name: "Main" }).getByRole("link").all();
    const hrefs = await Promise.all(links.map((l) => l.getAttribute("href")));
    expect(hrefs).toHaveLength(19);
    for (const href of hrefs) {
      const res = await page.goto(href!);
      expect(res?.status(), href!).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
    await page.getByRole("banner").getByRole("button", { name: "Switch to light mode" }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await page.reload();
    await expect(
      page.getByRole("banner").getByRole("button", { name: "Switch to dark mode" }),
    ).toBeVisible();
  });
});
