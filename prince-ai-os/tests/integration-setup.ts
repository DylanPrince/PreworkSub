import { execSync } from "node:child_process";
import path from "node:path";

/**
 * Applies migrations (non-destructive) and the idempotent seed to the dedicated integration
 * database. Tests create uniquely-named records instead of wiping data, so the suite never needs a
 * destructive reset.
 */
export default function setup() {
  const url =
    process.env.IT_DATABASE_URL ?? "postgresql://prince:prince@localhost:5432/prince_ai_os_it";
  const cwd = path.resolve(import.meta.dirname, "../packages/database");
  const env = { ...process.env, DATABASE_URL: url };
  execSync("npx prisma migrate deploy", { cwd, env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { cwd, env, stdio: "pipe" });
}
