import { z } from "zod";
import type { MembershipRole, PrismaClient } from "@prince/database";
import { requireBusinessRole } from "../access";
import { NotFoundError, ValidationError } from "../errors";

/**
 * Shared input rules for business-module records (finance, e-commerce, content, marketing, SaaS).
 * Money is entered in USD with at most two decimals; dates are calendar days (YYYY-MM-DD, UTC).
 */

export const MAX_MONEY = 1_000_000_000;

export const money = z.coerce
  .number({ message: "Enter an amount" })
  .refine(Number.isFinite, "Enter an amount")
  .refine((n) => n >= 0, "Amounts cannot be negative")
  .refine((n) => n <= MAX_MONEY, "Amount is too large")
  .transform((n) => Math.round(n * 100) / 100);

/** Empty input means "not known yet", stored as null (never as 0). */
// Zod 4 needs .optional() for a key that may be missing; the union alone does not make it so.
export const optionalMoney = z
  .union([z.literal(""), z.null(), money])
  .optional()
  .transform((v) => (v === "" || v == null ? null : v));

export const percent = z.coerce
  .number({ message: "Enter a percentage" })
  .refine((n) => Number.isFinite(n) && n >= 0 && n <= 100, "Use a percentage from 0 to 100");

export const optionalPercent = z
  .union([z.literal(""), z.null(), percent])
  .optional()
  .transform((v) => (v === "" || v == null ? null : v));

export const optionalInt = (label: string) =>
  z
    .union([
      z.literal(""),
      z.null(),
      z.coerce.number().int(`${label} must be a whole number`).min(0).max(100_000),
    ])
    .optional()
    .transform((v) => (v === "" || v == null ? null : v));

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const day = z
  .string()
  .regex(DAY, "Use a date like 2026-10-13")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "Use a valid date")
  .transform((s) => new Date(`${s}T00:00:00Z`));

export const optionalDay = z
  .union([z.literal(""), z.null(), day])
  .optional()
  .transform((v) => (v === "" || v == null ? null : v));

export const shortText = (label: string, max = 200) =>
  z
    .string()
    .trim()
    .min(2, `${label} must be at least 2 characters`)
    .max(max, `${label} must be at most ${max.toLocaleString("en-US")} characters`);

export const longText = (max = 20_000) => z.string().trim().max(max).default("");

/** http(s) URL or empty. */
export const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .refine((s) => s === "" || /^https?:\/\/\S+$/i.test(s), "Use a full http(s) address")
  .default("");

export function parseInput<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const r = schema.safeParse(raw);
  if (!r.success)
    throw new ValidationError("Check the highlighted fields", z.flattenError(r.error).fieldErrors);
  return r.data;
}

/** Loads a business-scoped record and checks the caller's role. Missing and forbidden look alike. */
export async function loadScoped<T extends { businessId: string }>(
  db: PrismaClient,
  userId: string,
  record: T | null,
  what: string,
  minRole: MembershipRole,
) {
  if (!record) throw new NotFoundError(what);
  const role = await requireBusinessRole(db, userId, record.businessId, minRole);
  return { record, role };
}

export const num = (d: { toString(): string } | null | undefined) => (d == null ? null : Number(d));

export const isoDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
