import { expect, test, type Page } from "@playwright/test";

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

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
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
    await expect(page.getByText("Mock AI provider is active")).toBeVisible();

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
