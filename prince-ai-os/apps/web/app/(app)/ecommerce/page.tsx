import { PlannedPage } from "@/components/common/planned-page";
import { navItem } from "@/lib/nav";

export const metadata = { title: "E-commerce" };

export default function Page() {
  return (
    <PlannedPage
      item={navItem("/ecommerce")}
      scope={[
        "Product research and supplier records",
        "Cost, shipping, fee and margin calculation with formulas",
        "Catalog and listing drafts",
        "Store adapters (e.g. Shopify) through official APIs only",
        "Orders and inventory only once a real integration is connected and tested",
        "Purchases, refunds and supplier payments always require approval",
      ]}
      availableNow={[]}
    />
  );
}
