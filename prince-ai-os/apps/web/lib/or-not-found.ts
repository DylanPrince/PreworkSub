import "server-only";
import { notFound } from "next/navigation";
import { ForbiddenError, NotFoundError } from "@prince/core";

/** Missing records and records the viewer cannot read both render the 404 page (no oracle). */
export async function orNotFound<T>(load: Promise<T>): Promise<T> {
  try {
    return await load;
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof ForbiddenError) notFound();
    throw e;
  }
}
