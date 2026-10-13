import { z } from "zod";
import type { Prisma, PrismaClient, Product, ProductStage, Supplier } from "@prince/database";
import { accessibleBusinessIds, requireBusinessRole } from "../access";
import { recordAudit } from "../audit";
import { ValidationError } from "../errors";
import {
  loadScoped,
  longText,
  num,
  optionalInt,
  optionalMoney,
  optionalPercent,
  optionalUrl,
  parseInput,
  shortText,
} from "./records";

/**
 * E-commerce foundation: product ideas with their cost structure, and supplier records. Margins are
 * calculated with visible formulas from the figures entered; missing figures are reported as
 * missing, never filled in. No store is connected: listing, ordering and paying happen elsewhere.
 */

export const PRODUCT_STAGES = [
  "idea",
  "researching",
  "sourcing",
  "ready",
  "listed",
  "retired",
] as const satisfies readonly ProductStage[];

export const supplierInput = z.object({
  businessId: z.string().min(1, "Choose a business"),
  name: shortText("Name", 120),
  website: optionalUrl,
  contact: z.string().trim().max(200).default(""),
  leadTimeDays: optionalInt("Lead time"),
  minimumOrder: optionalInt("Minimum order"),
  notes: longText(5_000),
});
export type SupplierInput = z.input<typeof supplierInput>;

export const productInput = z.object({
  businessId: z.string().min(1, "Choose a business"),
  name: shortText("Name", 120),
  description: longText(5_000),
  stage: z.enum(PRODUCT_STAGES).default("idea"),
  supplierId: z
    .string()
    .nullish()
    .transform((v) => v || null),
  priceUsd: optionalMoney,
  unitCostUsd: optionalMoney,
  shippingCostUsd: optionalMoney,
  feePercent: optionalPercent,
  feeFixedUsd: optionalMoney,
  source: z.enum(["user_entered", "estimated"]).default("user_entered"),
  notes: longText(5_000),
});
export type ProductInput = z.input<typeof productInput>;

async function checkSupplier(db: PrismaClient, businessId: string, supplierId: string | null) {
  if (!supplierId) return;
  const s = await db.supplier.findUnique({ where: { id: supplierId } });
  if (!s || s.businessId !== businessId || s.archivedAt)
    throw new ValidationError("Check the highlighted fields", {
      supplierId: ["Choose a supplier of this business"],
    });
}

export async function createSupplier(db: PrismaClient, userId: string, raw: SupplierInput) {
  const input = parseInput(supplierInput, raw);
  await requireBusinessRole(db, userId, input.businessId, "member");
  return db.$transaction(async (tx) => {
    const s = await tx.supplier.create({ data: { ...input, createdById: userId } });
    await recordAudit(tx, {
      actorType: "user",
      actorId: userId,
      businessId: input.businessId,
      action: "supplier.created",
      targetType: "supplier",
      targetId: s.id,
      summary: `Added supplier ${s.name}`,
    });
    return s;
  });
}

export async function archiveSupplier(db: PrismaClient, userId: string, supplierId: string) {
  const { record } = await loadScoped(
    db,
    userId,
    await db.supplier.findUnique({ where: { id: supplierId } }),
    "Supplier",
    "member",
  );
  if (record.archivedAt) return;
  await db.supplier.update({ where: { id: supplierId }, data: { archivedAt: new Date() } });
  await recordAudit(db, {
    actorType: "user",
    actorId: userId,
    businessId: record.businessId,
    action: "supplier.archived",
    targetType: "supplier",
    targetId: supplierId,
    summary: `Archived supplier ${record.name}`,
  });
}

export async function createProduct(db: PrismaClient, userId: string, raw: ProductInput) {
  const input = parseInput(productInput, raw);
  await requireBusinessRole(db, userId, input.businessId, "member");
  await checkSupplier(db, input.businessId, input.supplierId);
  return db.$transaction(async (tx) => {
    const p = await tx.product.create({ data: { ...input, createdById: userId } });
    await recordAudit(tx, {
      actorType: "user",
      actorId: userId,
      businessId: input.businessId,
      action: "product.created",
      targetType: "product",
      targetId: p.id,
      summary: `Added product ${p.name} (${p.stage})`,
    });
    return p;
  });
}

export async function updateProduct(
  db: PrismaClient,
  userId: string,
  productId: string,
  raw: ProductInput,
) {
  const { record } = await loadScoped(
    db,
    userId,
    await db.product.findUnique({ where: { id: productId } }),
    "Product",
    "member",
  );
  const input = parseInput(productInput, { ...raw, businessId: record.businessId });
  await checkSupplier(db, record.businessId, input.supplierId);
  const changed = (Object.keys(input) as (keyof typeof input)[]).filter((k) => {
    const before = record[k as keyof Product];
    const after = input[k];
    const norm = (v: unknown) =>
      v == null ? null : typeof v === "object" ? Number(v as Prisma.Decimal) : v;
    return norm(before) !== norm(after);
  });
  if (changed.length === 0) return record;
  return db.$transaction(async (tx) => {
    const p = await tx.product.update({ where: { id: productId }, data: input });
    await recordAudit(tx, {
      actorType: "user",
      actorId: userId,
      businessId: record.businessId,
      action: "product.updated",
      targetType: "product",
      targetId: productId,
      summary: `Updated ${p.name}: ${changed.join(", ")}`.slice(0, 500),
    });
    return p;
  });
}

export async function archiveProduct(db: PrismaClient, userId: string, productId: string) {
  const { record } = await loadScoped(
    db,
    userId,
    await db.product.findUnique({ where: { id: productId } }),
    "Product",
    "member",
  );
  if (record.archivedAt) return;
  await db.product.update({ where: { id: productId }, data: { archivedAt: new Date() } });
  await recordAudit(db, {
    actorType: "user",
    actorId: userId,
    businessId: record.businessId,
    action: "product.archived",
    targetType: "product",
    targetId: productId,
    summary: `Archived product ${record.name}`,
  });
}

export interface ProductEconomics {
  /** Figures needed for the margin that have not been entered. */
  missing: string[];
  feeUsd: number | null;
  landedCostUsd: number | null;
  profitPerUnitUsd: number | null;
  marginPercent: number | null;
  /** Return on ad spend at which advertising breaks even: price ÷ profit per unit. */
  breakEvenRoas: number | null;
  formulas: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Unit economics from the entered figures, with each formula spelled out. */
export function productEconomics(p: {
  priceUsd: number | null;
  unitCostUsd: number | null;
  shippingCostUsd: number | null;
  feePercent: number | null;
  feeFixedUsd: number | null;
}): ProductEconomics {
  const missing: string[] = [];
  if (p.priceUsd == null) missing.push("price");
  if (p.unitCostUsd == null) missing.push("unit cost");
  const formulas: string[] = [];
  if (missing.length)
    return {
      missing,
      feeUsd: null,
      landedCostUsd: null,
      profitPerUnitUsd: null,
      marginPercent: null,
      breakEvenRoas: null,
      formulas,
    };
  const price = p.priceUsd!;
  const shipping = p.shippingCostUsd ?? 0;
  const feeUsd = round2((price * (p.feePercent ?? 0)) / 100 + (p.feeFixedUsd ?? 0));
  const landed = round2(p.unitCostUsd! + shipping + feeUsd);
  const profit = round2(price - landed);
  const margin = price > 0 ? round2((profit / price) * 100) : null;
  formulas.push(
    `Fees = ${price.toFixed(2)} × ${(p.feePercent ?? 0).toFixed(2)}% + ${(p.feeFixedUsd ?? 0).toFixed(2)} = ${feeUsd.toFixed(2)}`,
    `Landed cost = unit cost ${p.unitCostUsd!.toFixed(2)} + shipping ${shipping.toFixed(2)} + fees ${feeUsd.toFixed(2)} = ${landed.toFixed(2)}`,
    `Profit per unit = price ${price.toFixed(2)} − landed cost ${landed.toFixed(2)} = ${profit.toFixed(2)}`,
  );
  if (margin != null)
    formulas.push(`Margin = ${profit.toFixed(2)} ÷ ${price.toFixed(2)} = ${margin.toFixed(2)}%`);
  const breakEvenRoas = profit > 0 ? round2(price / profit) : null;
  if (breakEvenRoas != null)
    formulas.push(
      `Break-even ROAS = price ÷ profit per unit = ${price.toFixed(2)} ÷ ${profit.toFixed(2)} = ${breakEvenRoas.toFixed(2)}`,
    );
  if (p.shippingCostUsd == null) missing.push("shipping (counted as 0)");
  if (p.feePercent == null && p.feeFixedUsd == null) missing.push("fees (counted as 0)");
  return {
    missing,
    feeUsd,
    landedCostUsd: landed,
    profitPerUnitUsd: profit,
    marginPercent: margin,
    breakEvenRoas,
    formulas,
  };
}

function productView(p: Product & { supplier?: Supplier | null }) {
  const figures = {
    priceUsd: num(p.priceUsd),
    unitCostUsd: num(p.unitCostUsd),
    shippingCostUsd: num(p.shippingCostUsd),
    feePercent: num(p.feePercent),
    feeFixedUsd: num(p.feeFixedUsd),
  };
  return { ...p, ...figures, economics: productEconomics(figures) };
}
export type ProductView = ReturnType<typeof productView>;

export async function listEcommerce(
  db: PrismaClient,
  userId: string,
  opts: { businessId?: string } = {},
) {
  const all = await accessibleBusinessIds(db, userId);
  const businessIds = opts.businessId ? all.filter((id) => id === opts.businessId) : all;
  const [products, suppliers] = await Promise.all([
    db.product.findMany({
      where: { businessId: { in: businessIds }, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      include: { supplier: true, business: { select: { id: true, name: true } } },
    }),
    db.supplier.findMany({
      where: { businessId: { in: businessIds }, archivedAt: null },
      orderBy: { name: "asc" },
      include: {
        business: { select: { id: true, name: true } },
        _count: { select: { products: { where: { archivedAt: null } } } },
      },
    }),
  ]);
  return {
    products: products.map((p) => ({ ...productView(p), business: p.business })),
    suppliers,
  };
}

export async function getProduct(db: PrismaClient, userId: string, productId: string) {
  const product = await db.product.findUnique({
    where: { id: productId },
    include: { supplier: true, business: true },
  });
  const { role } = await loadScoped(db, userId, product, "Product", "viewer");
  const suppliers = await db.supplier.findMany({
    where: { businessId: product!.businessId, archivedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return {
    product: { ...productView(product!), business: product!.business },
    suppliers,
    canEdit: role !== "viewer",
  };
}

/** Plain-text description of a product for an agent's task (data, not instructions). */
export function productContext(p: ProductView & { supplier?: Supplier | null }) {
  const usd = (n: number | null) => (n == null ? "not entered" : `$${n.toFixed(2)}`);
  const e = p.economics;
  return [
    `Product: ${p.name} (stage: ${p.stage}; figures are ${p.source.replace("_", " ")})`,
    p.description && `Description: ${p.description}`,
    `Price: ${usd(p.priceUsd)}; unit cost: ${usd(p.unitCostUsd)}; shipping: ${usd(p.shippingCostUsd)}; fees: ${p.feePercent == null ? "not entered" : `${p.feePercent}%`} + ${usd(p.feeFixedUsd)}`,
    e.formulas.length ? `Calculated:\n${e.formulas.map((f) => `- ${f}`).join("\n")}` : "",
    e.missing.length ? `Missing figures: ${e.missing.join(", ")}` : "",
    p.supplier &&
      `Supplier: ${p.supplier.name}${p.supplier.leadTimeDays != null ? `, lead time ${p.supplier.leadTimeDays} days` : ""}${p.supplier.minimumOrder != null ? `, minimum order ${p.supplier.minimumOrder}` : ""}`,
    p.notes && `Notes: ${p.notes}`,
  ]
    .filter(Boolean)
    .join("\n");
}
