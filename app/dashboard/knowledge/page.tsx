import { getKnowledgeItems } from "@/lib/data/knowledge";
import { getPromotions } from "@/lib/data/promotions";
import { getBusiness } from "@/lib/data/business";
import { getMenuForBusiness } from "@/lib/data/menu";
import { PageHeader } from "@/components/dashboard/page-header";
import { KnowledgeClient } from "@/components/dashboard/knowledge-client";

export const dynamic = "force-dynamic";

// See app/dashboard/menu/page.tsx for why this is needed — the website
// and paste-text import actions here can take well past Vercel's
// default function timeout when rendering a JS-heavy page.
export const maxDuration = 180;

export default async function KnowledgePage() {
  const business = await getBusiness();
  const [items, promotions, menu] = await Promise.all([getKnowledgeItems(), getPromotions(), getMenuForBusiness(business.id)]);
  const menuOptions = menu.items.filter((i) => i.is_active).map((i) => ({ id: i.id, name: i.name }));

  return (
    <div>
      <PageHeader title="Knowledge" description="What your AI order-taker knows about your business and policies. For menu items and prices, see the Menu page." />
      <KnowledgeClient initialItems={items} initialPromotions={promotions} menuOptions={menuOptions} />
    </div>
  );
}
