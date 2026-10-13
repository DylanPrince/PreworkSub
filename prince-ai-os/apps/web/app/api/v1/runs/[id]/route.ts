import { NextResponse } from "next/server";
import { requireBusinessRole } from "@prince/core";
import { getSession } from "@/lib/session";
import { db } from "@/lib/server";

/** v1 run status contract polled by the task page. Returns only non-sensitive status fields. */
export interface RunStatusV1 {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  attempts: number;
  cancelRequested: boolean;
  updatedEvents: number;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const run = await db.agentRun.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      attempts: true,
      cancelRequestedAt: true,
      businessId: true,
      _count: { select: { events: true } },
    },
  });
  if (!run) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    await requireBusinessRole(db, session.user.id, run.businessId, "viewer");
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const body: RunStatusV1 = {
    id: run.id,
    status: run.status,
    attempts: run.attempts,
    cancelRequested: run.cancelRequestedAt !== null,
    updatedEvents: run._count.events,
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
