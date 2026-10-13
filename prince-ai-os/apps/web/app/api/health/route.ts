import { NextResponse } from "next/server";
import { db, getRunQueue } from "@/lib/server";

/** Liveness/readiness: checks Postgres and Redis. Exposes no configuration or secrets. */
export async function GET() {
  const checks: Record<string, "ok" | "error"> = {};
  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "error";
  }
  try {
    await getRunQueue().counts();
    checks.queue = "ok";
  } catch {
    checks.queue = "error";
  }
  const ok = Object.values(checks).every((v) => v === "ok");
  return NextResponse.json(
    { status: ok ? "ok" : "degraded", checks },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
