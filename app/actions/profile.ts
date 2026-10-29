"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { CAPTCHA_MISSING, isCaptchaError } from "@/lib/security/captcha";
import { isRateLimited, recordRateLimitHit } from "@/lib/security/rateLimit";
import { getSiteUrl } from "@/lib/env";
import type { ActionResult } from "./business";

export async function updateProfileNameAction(fullName: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) return { success: false, error: "You need to be logged in." };

  const { error: authError } = await supabase.auth.updateUser({ data: { full_name: fullName } });
  if (authError) return { success: false, error: authError.message };

  const admin = createAdminClient();
  await admin.from("users").upsert({ id: user.id, email: user.email || "", full_name: fullName }, { onConflict: "id" });

  revalidatePath("/dashboard/settings");
  return { success: true };
}

/**
 * Changing the email or password needs the CURRENT password. A stolen or
 * left-open session would otherwise be enough to take the account over for
 * good. Checked with a separate, throwaway sign-in (nothing is stored), and
 * wrong guesses are limited.
 */
async function verifyCurrentPassword(currentPassword: string, captchaToken?: string): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, error: "You need to be logged in." };
  if (!currentPassword) return { ok: false, error: "Enter your current password." };

  const failKey = `reauth_fail:${user.id}`;
  if (await isRateLimited(failKey, 5, 15)) return { ok: false, error: "Too many wrong passwords. Please wait a few minutes and try again." };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return { ok: false, error: "Not configured." };
  const checker = createSupabaseClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await checker.auth.signInWithPassword({ email: user.email, password: currentPassword, options: { captchaToken: captchaToken || undefined } });
  if (error) {
    // The bot check failing isn't a wrong password.
    if (isCaptchaError(error.message)) return { ok: false, error: CAPTCHA_MISSING };
    await recordRateLimitHit(failKey);
    return { ok: false, error: "Your current password isn't right." };
  }
  await checker.auth.signOut().catch(() => {});
  return { ok: true, userId: user.id };
}

export async function updateEmailAction(newEmail: string, currentPassword: string, captchaToken?: string): Promise<ActionResult> {
  const check = await verifyCurrentPassword(currentPassword, captchaToken);
  if (!check.ok) return { success: false, error: check.error };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ email: newEmail }, { emailRedirectTo: `${getSiteUrl()}/auth/confirm?next=${encodeURIComponent("/dashboard/settings?tab=account")}` });
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function updatePasswordAction(newPassword: string, currentPassword: string, captchaToken?: string): Promise<ActionResult> {
  if (newPassword.length < 8) return { success: false, error: "Password must be at least 8 characters." };
  const check = await verifyCurrentPassword(currentPassword, captchaToken);
  if (!check.ok) return { success: false, error: check.error };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { success: false, error: error.message };
  return { success: true };
}
