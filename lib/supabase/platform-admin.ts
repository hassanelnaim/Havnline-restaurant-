import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

/**
 * Platform-level admin check — completely separate from the per-
 * business "owner/admin/member" roles used inside business_members.
 * Those control who manages ONE business; this controls who can see
 * ACROSS every business on the platform.
 *
 * Deliberately simple for now: a single owner email, set via env var,
 * checked against the logged-in user. The full role-based admin auth
 * system (2FA, multiple admin roles, session management, etc.) is a
 * genuinely separate, larger project — this is the minimal real gate
 * needed to safely ship a platform overview today.
 */
export async function isPlatformAdmin(): Promise<boolean> {
  // Demo mode (no Supabase configured) — same fallback every other
  // data module uses, so /admin can be previewed without a real
  // project connected instead of crashing on the auth check.
  if (!isSupabaseConfigured()) return true;

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return false;

  const adminEmail = process.env.PLATFORM_ADMIN_EMAIL;
  if (!adminEmail) return false;

  return user.email.toLowerCase() === adminEmail.toLowerCase();
}
