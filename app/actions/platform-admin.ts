"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/supabase/platform-admin";

export interface ActionResult {
  success: boolean;
  error?: string;
}

const DEMO_MODE_ERROR = "This is a preview with demo data — connect Supabase to make real changes.";

export async function updateBusinessSubscriptionStatusAction(businessId: string, status: string): Promise<ActionResult> {
  const allowed = await isPlatformAdmin();
  if (!allowed) return { success: false, error: "Not authorized." };
  if (!isSupabaseConfigured()) return { success: false, error: DEMO_MODE_ERROR };

  const admin = createAdminClient();
  const { error } = await admin.from("businesses").update({ subscription_status: status }).eq("id", businessId);
  if (error) return { success: false, error: error.message };

  revalidatePath("/admin");
  revalidatePath(`/admin/businesses/${businessId}`);
  return { success: true };
}

export async function moderateReviewAction(reviewId: string, status: "approved" | "rejected"): Promise<ActionResult> {
  const allowed = await isPlatformAdmin();
  if (!allowed) return { success: false, error: "Not authorized." };
  if (!isSupabaseConfigured()) return { success: false, error: DEMO_MODE_ERROR };

  const admin = createAdminClient();
  const { error } = await admin.from("reviews").update({ status }).eq("id", reviewId);
  if (error) return { success: false, error: error.message };

  revalidatePath("/admin");
  revalidatePath("/");
  return { success: true };
}
