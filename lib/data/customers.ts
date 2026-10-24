import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { mockCustomers } from "@/lib/mock/data";
import type { DbCustomer } from "@/lib/database/types";
import { fetchAllRows } from "@/lib/supabase/fetchAll";

export async function getCustomers(): Promise<DbCustomer[]> {
  if (!isSupabaseConfigured()) return mockCustomers;
  const businessId = await getCurrentBusinessId();
  if (!businessId) return mockCustomers;

  const supabase = await createClient();
  // Every customer, not just the newest 1,000 (lib/supabase/fetchAll.ts).
  const { data, error } = await fetchAllRows((from, to) =>
    supabase.from("customers").select("*").eq("business_id", businessId).order("created_at", { ascending: false }).order("id").range(from, to)
  );
  return error && data.length === 0 ? mockCustomers : data;
}

export async function getCustomer(customerId: string): Promise<DbCustomer | null> {
  if (!isSupabaseConfigured()) return mockCustomers.find((c) => c.id === customerId) || null;
  const supabase = await createClient();
  const { data } = await supabase.from("customers").select("*").eq("id", customerId).maybeSingle();
  return data || null;
}

// Re-exported for backward compatibility — the real implementation now
// lives in lib/customer-utils.ts (a client-safe file with zero server
// imports), so client components can import the pure counting logic
// directly without accidentally pulling this server-only data module
// (and its next/headers dependency) into the browser bundle.
export { countNewCustomers } from "@/lib/customer-utils";
