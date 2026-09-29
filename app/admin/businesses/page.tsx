import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { mockAdminBusinesses } from "@/lib/mock/data";
import { BusinessListClient } from "@/components/admin/business-list-client";
import { AutoRefresh } from "@/components/admin/auto-refresh";

export const dynamic = "force-dynamic";

export default async function AdminBusinessesPage() {
  const demoMode = !isSupabaseConfigured();

  const businesses = demoMode
    ? mockAdminBusinesses
    : (async () => {
        const admin = createAdminClient();
        const { data } = await admin
          .from("businesses")
          .select("id, name, phone, subscription_status, cancel_at_period_end, current_period_end, created_at")
          .order("created_at", { ascending: false });
        return data || [];
      })();

  const rows = await businesses;

  return (
    <div>
      <AutoRefresh />
      <Link href="/admin" className="flex items-center gap-1.5 text-[13px] font-medium text-text-muted hover:text-text">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Command Center
      </Link>

      <div className="mt-4">
        <h1 className="font-display text-[24px] font-semibold text-ink">All businesses</h1>
        <p className="mt-1 text-[13.5px] text-text-muted">{rows.length} on HavnLine.</p>
      </div>

      <div className="mt-6">
        <BusinessListClient businesses={rows} />
      </div>
    </div>
  );
}
