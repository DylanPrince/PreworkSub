import { Archive, ArrowLeft } from "lucide-react";
import Link from "next/link";
import {
  PRODUCT_STAGES,
  askableAgents,
  getProduct,
  preferredAgentId,
  tasksAbout,
} from "@prince/core";
import { formatMoney } from "@prince/shared";
import { PageHeader } from "@/components/common/page-header";
import { Stat } from "@/components/common/stat";
import { StatusBadge } from "@/components/common/status-badge";
import { ActionButton } from "@/components/modules/action-button";
import { AgentPanel } from "@/components/modules/agent-panel";
import { EditProductForm } from "@/components/modules/ecommerce-forms";
import { toOptions } from "@/components/modules/options";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { archiveProductAction } from "@/lib/module-actions";
import { orNotFound } from "@/lib/or-not-found";
import { getRunModes } from "@/lib/run-modes";
import { db } from "@/lib/server";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Product" };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { product: p, suppliers, canEdit } = await orNotFound(getProduct(db, user.id, id));
  const [agents, related, modes] = await Promise.all([
    askableAgents(db, p.businessId),
    tasksAbout(db, "product", p.id),
    getRunModes(),
  ]);
  const e = p.economics;
  const source = p.source === "estimated" ? "estimated" : "user_entered";
  const editable = canEdit && !p.archivedAt;

  return (
    <div className="space-y-6">
      <Link
        href="/ecommerce"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> E-commerce
      </Link>
      <PageHeader
        title={p.name}
        description={`${p.business.name}${p.supplier ? ` · supplier ${p.supplier.name}` : ""}`}
        actions={
          <>
            <StatusBadge status={p.stage} />
            {p.archivedAt && <Badge>Archived</Badge>}
            {editable && (
              <ActionButton
                variant="danger"
                action={archiveProductAction.bind(null, p.id)}
                confirm={`Archive ${p.name}? It leaves the product list; its history is kept.`}
                redirectTo="/ecommerce"
              >
                <Archive /> Archive
              </ActionButton>
            )}
          </>
        }
      />

      <section
        aria-label="Unit economics"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <Stat
          label="Selling price"
          value={p.priceUsd == null ? null : formatMoney(p.priceUsd)}
          source={p.priceUsd == null ? "not_tracked" : source}
        />
        <Stat
          label="Landed cost per unit"
          value={e.landedCostUsd == null ? null : formatMoney(e.landedCostUsd)}
          source={e.landedCostUsd == null ? "not_tracked" : source}
          hint="Unit cost + shipping + fees"
        />
        <Stat
          label="Profit per unit"
          value={e.profitPerUnitUsd == null ? null : formatMoney(e.profitPerUnitUsd)}
          source={e.profitPerUnitUsd == null ? "not_tracked" : source}
          hint={e.marginPercent == null ? undefined : `Margin ${e.marginPercent.toFixed(1)}%`}
        />
        <Stat
          label="Break-even ROAS"
          value={e.breakEvenRoas == null ? null : `${e.breakEvenRoas.toFixed(2)}×`}
          source={e.breakEvenRoas == null ? "not_tracked" : source}
          hint="Ad return needed to cover the profit per unit"
        />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>How the numbers are worked out</CardTitle>
                <CardDescription>
                  Calculated from the figures entered below; nothing is looked up or assumed.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {e.formulas.length > 0 ? (
                <ul className="space-y-1 font-mono text-xs">
                  {e.formulas.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              ) : null}
              {e.missing.length > 0 && (
                <p className="text-xs text-warning">Missing: {e.missing.join(", ")}.</p>
              )}
              {e.profitPerUnitUsd != null && e.profitPerUnitUsd <= 0 && (
                <p role="alert" className="text-sm text-danger">
                  This product loses money on every unit at the current figures.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{editable ? "Edit product" : "Details"}</CardTitle>
            </CardHeader>
            <CardContent>
              {editable ? (
                <EditProductForm
                  productId={p.id}
                  suppliers={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                  stages={toOptions(PRODUCT_STAGES)}
                  defaults={{
                    name: p.name,
                    description: p.description,
                    stage: p.stage,
                    supplierId: p.supplierId,
                    priceUsd: p.priceUsd,
                    unitCostUsd: p.unitCostUsd,
                    shippingCostUsd: p.shippingCostUsd,
                    feePercent: p.feePercent,
                    feeFixedUsd: p.feeFixedUsd,
                    source: p.source,
                    notes: p.notes,
                  }}
                />
              ) : (
                <dl className="space-y-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Description</dt>
                    <dd className="whitespace-pre-wrap">{p.description || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Notes</dt>
                    <dd className="whitespace-pre-wrap">{p.notes || "—"}</dd>
                  </div>
                </dl>
              )}
            </CardContent>
          </Card>
        </div>

        <AgentPanel
          subjectType="product"
          subjectId={p.id}
          agents={agents}
          defaultAgentId={preferredAgentId(agents, "market-research")}
          suggestions={[
            "Assess demand and competition for this product and say whether it is worth sourcing.",
            "Suggest a price point that keeps a healthy margin, using the figures here.",
            "Write a product page description for this product.",
          ]}
          modes={modes}
          tasks={related}
          canAsk={canEdit}
        />
      </div>
    </div>
  );
}
