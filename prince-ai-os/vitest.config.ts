import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const IT_DB =
  process.env.IT_DATABASE_URL ?? "postgresql://prince:prince@localhost:5432/prince_ai_os_it";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "apps/web") } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["packages/**/*.test.ts"],
          exclude: ["**/*.int.test.ts", "**/node_modules/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "components",
          environment: "jsdom",
          include: ["apps/web/**/*.test.tsx"],
          exclude: ["**/node_modules/**"],
          setupFiles: ["./tests/setup-dom.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["packages/**/*.int.test.ts"],
          globalSetup: ["./tests/integration-setup.ts"],
          fileParallelism: false,
          env: {
            NODE_ENV: "test",
            DATABASE_URL: IT_DB,
            BETTER_AUTH_SECRET: "integration-secret-integration-secret-0123",
            AI_PROVIDER: "mock",
            AI_DAILY_BUDGET_USD: "5",
            AI_MONTHLY_BUDGET_USD: "50",
          },
        },
      },
    ],
  },
});
