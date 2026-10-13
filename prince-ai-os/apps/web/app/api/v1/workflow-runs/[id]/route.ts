import { NextResponse } from "next/server";
import { ForbiddenError, NotFoundError, workflowRunSignature } from "@prince/core";
import { getSession } from "@/lib/session";
import { db } from "@/lib/server";

/** v1 workflow run progress contract polled by the run page. Status signature only. */
export interface WorkflowRunStatusV1 {
  signature: string;
  active: boolean;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const body: WorkflowRunStatusV1 = await workflowRunSignature(db, session.user.id, id);
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    // Same response for missing and forbidden: no existence oracle.
    if (e instanceof NotFoundError || e instanceof ForbiddenError)
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw e;
  }
}
