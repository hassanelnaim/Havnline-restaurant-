import { getBusiness } from "@/lib/data/business";
import { getMenuForBusiness } from "@/lib/data/menu";
import { PageHeader } from "@/components/dashboard/page-header";
import { MenuClient } from "@/components/dashboard/menu-client";

export const dynamic = "force-dynamic";

// This page's website-import server action can take 20-40+ seconds when
// it has to render a JavaScript-heavy page (and retry once through a
// stealth proxy if the site blocks the first attempt) — well past
// Vercel's default function timeout, which would otherwise cut the
// import off mid-request. Capped at 60s here; note Vercel's Hobby plan
// may still enforce a lower cap regardless of this setting.
export const maxDuration = 60;

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
