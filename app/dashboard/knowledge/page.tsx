import { redirect } from "next/navigation";
import { getKnowledgeItems } from "@/lib/data/knowledge";
import { PageHeader } from "@/components/dashboard/page-header";
import { KnowledgeClient } from "@/components/dashboard/knowledge-client";

export const dynamic = "force-dynamic";

// See app/dashboard/menu/page.tsx for why this is needed — the website
// and paste-text import actions here can take well past Vercel's
// default function timeout when rendering a JS-heavy page.
export const maxDuration = 180;

export default async function KnowledgePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  // Promotions moved to the Menu page. Old links (bookmarks, earlier
  // dashboard ideas) still land on the right form, with their prefill.
  if (searchParams.tab === "promotions" || searchParams.prefill === "1") {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) if (typeof v === "string") q.set(k, v);
    q.set("tab", "promotions");
    redirect(`/dashboard/menu?${q.toString()}`);
  }

  const items = await getKnowledgeItems();

  return (
    <div>
      <PageHeader title="Knowledge" description="What your AI knows about your restaurant beyond the menu — answers to common questions, policies and business info." />
      <KnowledgeClient initialItems={items} />
    </div>
  );
}
