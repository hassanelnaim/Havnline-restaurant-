"use server";

import { isSupabaseConfigured } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, getClientIp } from "@/lib/security/rateLimit";
import { dbErrorResult } from "@/lib/errors";

export interface SubmitReviewResult {
  success: boolean;
  error?: string;
}

export async function submitReviewAction(input: {
  businessName: string;
  reviewerName: string;
  rating: number;
  reviewText: string;
}): Promise<SubmitReviewResult> {
  if (!isSupabaseConfigured()) return { success: true };

  // Real rate limiting — this endpoint requires no login at all, so
  // without this, anyone could script thousands of fake submissions
  // into the moderation queue.
  const ip = getClientIp();
  const allowed = await checkRateLimit(`review_submit:${ip}`, 3, 60);
  if (!allowed) {
    return { success: false, error: "Too many review submissions from this connection. Please try again later." };
  }

  if (!input.businessName.trim() || !input.reviewerName.trim() || !input.reviewText.trim()) {
    return { success: false, error: "All fields are required." };
  }
  if (input.rating < 1 || input.rating > 5) {
    return { success: false, error: "Rating must be between 1 and 5." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("reviews").insert({
    business_name: input.businessName,
    reviewer_name: input.reviewerName,
    rating: input.rating,
    review_text: input.reviewText,
    status: "pending",
  });

  if (error) return dbErrorResult(error, "submitReviewAction", "Could not submit your review.");
  return { success: true };
}
