import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mockPendingReviews } from "@/lib/mock/data";
import type { DbReview } from "@/lib/database/types";

/** Public: only ever approved reviews — used on the landing page. */
export async function getApprovedReviews(): Promise<DbReview[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = createClient();
  const { data } = await supabase.from("reviews").select("*").eq("status", "approved").order("created_at", { ascending: false });
  return data || [];
}

/** Admin only: every review regardless of status, for moderation. */
export async function getAllReviewsForModeration(): Promise<DbReview[]> {
  if (!isSupabaseConfigured()) return mockPendingReviews;
  const admin = createAdminClient();
  const { data } = await admin.from("reviews").select("*").order("created_at", { ascending: false });
  return data || [];
}
