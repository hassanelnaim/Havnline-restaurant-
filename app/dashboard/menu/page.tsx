import { getBusiness } from "@/lib/data/business";
import { getMenuForBusiness } from "@/lib/data/menu";
import { PageHeader } from "@/components/dashboard/page-header";
import { MenuClient } from "@/components/dashboard/menu-client";

export const dynamic = "force-dynamic";

export default async function MenuPage() {
  const business = await getBusiness();
  const { categories, items } = await getMenuForBusiness(business.id);

  return (
    <div>
      <PageHeader
        title="Menu"
        description={
          business.spoton_connected_at
            ? "Your AI only offers items here that are also mapped to SpotOn — that's what lets an order actually reach your kitchen printer."
            : "Your AI only offers items and prices listed here — never invented. Connect SpotOn in Integrations to sync your real menu and let orders reach your kitchen printer automatically."
        }
      />
      <MenuClient initialCategories={categories} initialItems={items} spotonConnected={Boolean(business.spoton_connected_at)} />
    </div>
  );
}
