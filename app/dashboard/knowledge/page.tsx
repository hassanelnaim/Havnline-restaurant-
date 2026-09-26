import { getKnowledgeItems } from "@/lib/data/knowledge";
import { getPromotions } from "@/lib/data/promotions";
import { PageHeader } from "@/components/dashboard/page-header";
import { KnowledgeClient } from "@/components/dashboard/knowledge-client";

export const dynamic = "force-dynamic";

// See app/dashboard/menu/page.tsx for why this is needed — the website
// and paste-text import actions here can take well past Vercel's
// default function timeout when rendering a JS-heavy page.
export const maxDuration = 60;

export default async function KnowledgePage() {
  const [items, promotions] = await Promise.all([getKnowledgeItems(), getPromotions()]);

  return (
    <div>
      <PageHeader title="Knowledge" description="What your AI order-taker knows about your business and policies. For menu items and prices, see the Menu page." />
      <KnowledgeClient initialItems={items} initialPromotions={promotions} />
    </div>
  );
}
