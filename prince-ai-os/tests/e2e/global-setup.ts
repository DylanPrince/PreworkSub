import { execSync } from "node:child_process";
import path from "node:path";

/** Non-destructive: applies migrations and the idempotent seed. Tests use unique accounts. */
export default function globalSetup() {
  const url =
    process.env.E2E_DATABASE_URL ?? "postgresql://prince:prince@localhost:5432/prince_ai_os_test";
  const cwd = path.resolve(import.meta.dirname, "../../packages/database");
  const env = { ...process.env, DATABASE_URL: url };
  execSync("npx prisma migrate deploy", { cwd, env, stdio: "inherit" });
  execSync("npx tsx prisma/seed.ts", { cwd, env, stdio: "inherit" });
}
