import { Archive } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { PRODUCT_STAGES, listBusinesses, listEcommerce, writableBusinesses } from "@prince/core";
import { formatMoney } from "@prince/shared";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { ActionButton } from "@/components/modules/action-button";
import { NewProductForm, SupplierForm } from "@/components/modules/ecommerce-forms";
import { toOptions } from "@/components/modules/options";
import { OverviewFilters } from "@/components/overview/filters";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { archiveSupplierAction } from "@/lib/module-actions";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata = { title: "E-commerce" };

export default async function EcommercePage({
  searchParams,
}: {
  searchParams: Promise<{ business?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const [businesses, writable] = await Promise.all([
    listBusinesses(db, user.id),
    writableBusinesses(db, user.id),
  ]);
  const scoped = businesses.find((b) => b.id === sp.business);
  const { products, suppliers } = await listEcommerce(db, user.id, { businessId: scoped?.id });
  const canWrite = new Set(writable.map((b) => b.id));
  const multi = businesses.length > 1 && !scoped;
  const businessOptions = writable.map((b) => ({ value: b.id, label: b.name }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="E-commerce"
        description="Product ideas, suppliers and unit economics from the figures you enter. No store or supplier account is connected: listing, ordering and paying happen outside Prince AI OS."
        actions={
          businesses.length > 1 && (
            <Suspense>
              <OverviewFilters
                businesses={businesses.map((b) => ({ id: b.id, name: b.name }))}
                ranges={[]}
              />
            </Suspense>
          )
        }
      />

      <Card className="overflow-x-auto">
        <CardHeader>
          <div>
            <CardTitle>Products</CardTitle>
            <CardDescription>
              Margin = (price − unit cost − shipping − fees) ÷ price. Open a product for the full
              calculation.
            </CardDescription>
          </div>
        </CardHeader>
        {products.length === 0 ? (
          <CardContent>
            <EmptyState
              title="No products yet"
              description="Add a product idea below, with whatever figures you know so far."
            />
          </CardContent>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">Products</caption>
            <thead className="border-y border-border text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Product</th>
                <th className="px-4 py-2.5 font-medium">Stage</th>
                <th className="px-4 py-2.5 text-right font-medium">Price</th>
                <th className="px-4 py-2.5 text-right font-medium">Profit / unit</th>
                <th className="px-4 py-2.5 text-right font-medium">Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {products.map((p) => {
                const e = p.economics;
                return (
                  <tr key={p.id}>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/ecommerce/products/${p.id}`}
                        className="font-medium hover:underline"
                      >
                        {p.name}
                      </Link>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {multi && <span>{p.business.name}</span>}
                        {p.supplier && <span>Supplier: {p.supplier.name}</span>}
                        {p.source === "estimated" && <Badge tone="info">Estimated</Badge>}
                      </p>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={p.stage} />
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {p.priceUsd == null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        formatMoney(p.priceUsd)
                      )}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-2.5 text-right font-mono tabular-nums",
                        (e.profitPerUnitUsd ?? 0) < 0 && "text-danger",
                      )}
                    >
                      {e.profitPerUnitUsd == null ? (
                        <span className="text-xs text-muted-foreground">
                          Needs {e.missing.filter((m) => !m.includes("counted")).join(" and ")}
                        </span>
                      ) : (
                        formatMoney(e.profitPerUnitUsd)
                      )}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-2.5 text-right font-mono tabular-nums",
                        (e.marginPercent ?? 0) < 0 && "text-danger",
                      )}
                    >
                      {e.marginPercent == null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        `${e.marginPercent.toFixed(1)}%`
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Add a product</CardTitle>
              <CardDescription>
                Leave unknown figures blank; they are shown as missing.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {businessOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {businesses.length === 0
                  ? "Create a business first."
                  : "Viewers can read products but not add them."}
              </p>
            ) : (
              <NewProductForm
                businesses={businessOptions}
                suppliers={suppliers
                  .filter((s) => canWrite.has(s.businessId))
                  .map((s) => ({ value: s.id, label: s.name, businessId: s.businessId }))}
                stages={toOptions(PRODUCT_STAGES)}
              />
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Suppliers</CardTitle>
                <CardDescription>
                  Contact details you keep; nobody is contacted from here.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {suppliers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No suppliers yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {suppliers.map((s) => (
                    <li key={s.id} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0 text-sm">
                        <p className="font-medium">
                          {s.website ? (
                            <a
                              href={s.website}
                              target="_blank"
                              rel="noopener noreferrer nofollow"
                              className="hover:underline"
                            >
                              {s.name}
                            </a>
                          ) : (
                            s.name
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {[
                            multi && s.business.name,
                            s.contact,
                            s.leadTimeDays != null && `${s.leadTimeDays}-day lead time`,
                            s.minimumOrder != null && `MOQ ${s.minimumOrder}`,
                            `${s._count.products} product${s._count.products === 1 ? "" : "s"}`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      {canWrite.has(s.businessId) && (
                        <ActionButton
                          variant="ghost"
                          action={archiveSupplierAction.bind(null, s.id)}
                          confirm={`Archive ${s.name}? Products keep their history but can no longer pick this supplier.`}
                          aria-label={`Archive ${s.name}`}
                        >
                          <Archive />
                        </ActionButton>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          {businessOptions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Add a supplier</CardTitle>
              </CardHeader>
              <CardContent>
                <SupplierForm businesses={businessOptions} />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
