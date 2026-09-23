import { getKnowledgeItems } from "@/lib/data/knowledge";
import { getPromotions } from "@/lib/data/promotions";
import { PageHeader } from "@/components/dashboard/page-header";
import { KnowledgeClient } from "@/components/dashboard/knowledge-client";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const [items, promotions] = await Promise.all([getKnowledgeItems(), getPromotions()]);

  return (
    <div>
      <PageHeader title="Knowledge" description="What your AI order-taker knows about your business and policies. For menu items and prices, see the Menu page." />
      <KnowledgeClient initialItems={items} initialPromotions={promotions} />
    </div>
  );
}
