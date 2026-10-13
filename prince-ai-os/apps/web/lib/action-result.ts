import "server-only";
import { ForbiddenError, NotFoundError, ValidationError } from "@prince/core";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

/** Runs a server action body, turning known errors into messages the form can show. */
export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof ValidationError)
      return { ok: false, error: error.message, fieldErrors: error.fieldErrors };
    if (error instanceof ForbiddenError || error instanceof NotFoundError)
      return { ok: false, error: error.message };
    // Unknown errors: log server-side, return a generic message (no internals to the browser).
    console.error("[action] unexpected error", error);
    return { ok: false, error: "Unexpected server error. Check the server logs." };
  }
}
