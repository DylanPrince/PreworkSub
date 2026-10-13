import { defineConfig, devices } from "@playwright/test";

/**
 * E2E runs against an isolated database (prince_ai_os_test) with the mock AI provider, so tests
 * never spend money or touch development data. globalSetup resets and seeds that database.
 */
const PORT = 3100;
const TEST_DB =
  process.env.E2E_DATABASE_URL ?? "postgresql://prince:prince@localhost:5432/prince_ai_os_test";
const env = {
  DATABASE_URL: TEST_DB,
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379/1",
  BETTER_AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-0123456789",
  BETTER_AUTH_URL: `http://localhost:${PORT}`,
  APP_ENV: "test",
  AUTH_ALLOW_SIGNUP: "true",
  AI_PROVIDER: "mock",
  AI_DAILY_BUDGET_USD: "5",
  AI_MONTHLY_BUDGET_USD: "50",
  NEXT_TELEMETRY_DISABLED: "1",
};

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH },
      },
    },
  ],
  webServer: [
    {
      // Production build: deterministic, no dev-mode recompiles or HMR reloads during tests.
      command: `pnpm --filter @prince/web build && pnpm --filter @prince/web exec next start -p ${PORT}`,
      url: `http://localhost:${PORT}/api/health`,
      env,
      reuseExistingServer: false,
      timeout: 300_000,
    },
    {
      command: "pnpm --filter @prince/worker exec tsx src/index.ts",
      env,
      reuseExistingServer: false,
      // The worker has no HTTP port; Playwright waits on the web server and the worker starts in parallel.
      wait: { stdout: /worker\.ready/ },
      timeout: 60_000,
    },
  ],
});
