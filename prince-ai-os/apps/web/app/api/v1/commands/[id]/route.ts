import { NextResponse } from "next/server";
import { ForbiddenError, NotFoundError, commandSignature } from "@prince/core";
import { getSession } from "@/lib/session";
import { db } from "@/lib/server";

/** v1 command progress contract polled by the Command Center. Status signature only. */
export interface CommandStatusV1 {
  signature: string;
  active: boolean;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const body: CommandStatusV1 = await commandSignature(db, session.user.id, id);
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    // Same response for missing and forbidden: no existence oracle.
    if (e instanceof NotFoundError || e instanceof ForbiddenError)
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw e;
  }
}
