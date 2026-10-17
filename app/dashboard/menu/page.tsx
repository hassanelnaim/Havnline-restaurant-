import { getBusiness } from "@/lib/data/business";
import { getMenuForBusiness } from "@/lib/data/menu";
import { PageHeader } from "@/components/dashboard/page-header";
import { MenuClient } from "@/components/dashboard/menu-client";
import { getPromotions } from "@/lib/data/promotions";
import { readPromotionPrefill, readInitialMenuTab } from "@/lib/analytics/promotionPrefill";
import { safeTimezone } from "@/lib/business/timezone";

export const dynamic = "force-dynamic";

// This page's website-import server action can take 20-40+ seconds when
// it has to render a JavaScript-heavy page (and retry once through a
// stealth proxy if the site blocks the first attempt) — well past
// Vercel's default function timeout, which would otherwise cut the
// import off mid-request. Vercel's Fluid Compute (on by default,
// including on Hobby) actually allows up to 300s here — this just needs
// to say so, since Vercel enforces whatever this is set to rather than
// silently re-capping it at some lower platform limit.
export const maxDuration = 180;

export default async function MenuPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const business = await getBusiness();
  const [{ categories, items, addonTemplates }, promotions] = await Promise.all([getMenuForBusiness(business.id), getPromotions()]);
  const timezone = safeTimezone(business.timezone);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const menuOptions = items.filter((i) => i.is_active).map((i) => ({ id: i.id, name: i.name }));

  return (
    <div>
      <PageHeader
        title="Menu"
        description="Your AI only offers items and prices listed here — never invented."
      />
      <MenuClient
        initialCategories={categories}
        initialItems={items}
        initialAddonTemplates={addonTemplates}
        initialTab={readInitialMenuTab(searchParams)}
        promotions={{ initialPromotions: promotions, menuOptions, prefill: readPromotionPrefill(searchParams), timezone, today }}
      />
    </div>
  );
}
