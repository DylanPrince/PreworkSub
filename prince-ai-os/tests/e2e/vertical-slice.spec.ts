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
    const research = workstreams.getByRole("listitem").filter({ hasText: "Research" }).first();
    const finance = workstreams.getByRole("listitem").filter({ hasText: "Financial check" });
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

    // The dependent task received the earlier result as context.
    await finance.getByRole("link", { name: /Financial Analyst task/ }).click();
    await expect(page.getByText(/Result of the earlier workstream "Research"/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Command Center request/ })).toBeVisible();
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
