import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import globals from "globals";
import tseslint from "typescript-eslint";

const scopeToWeb = (configs) => configs.map((c) => ({ ...c, files: ["apps/web/**/*.{ts,tsx}"] }));

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/coverage/**",
      "packages/database/src/generated/**",
      "playwright-report/**",
      "test-results/**",
      "apps/web/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["error", "warn"] }],
    },
  },
  ...scopeToWeb(nextVitals),
  ...scopeToWeb(nextTs),
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    settings: { next: { rootDir: "apps/web" } },
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ["**/prisma/seed.ts", "apps/worker/**", "tests/**"],
    rules: { "no-console": "off" },
  },
);
