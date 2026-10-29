import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const OTP_TYPES: EmailOtpType[] = ["signup", "email", "recovery", "invite", "magiclink", "email_change"];

/** Only paths on this site, so a link can't send someone to another website. */
function safeNext(next: string | null, fallback: string): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return fallback;
  return next;
}

/**
 * GET /auth/confirm — where every account email link lands: verifying a new
 * account, resetting a password, confirming a new email address.
 *
 * Two kinds of link reach it:
 * - ?token_hash=…&type=… (the email templates set up in Supabase): works on
 *   any device, so opening the email on a phone is fine.
 * - ?code=… (Supabase's default links): works in the same browser that
 *   asked for the email.
 * Either way the person ends up signed in and sent on: a new account to
 * onboarding, a password reset to the page that sets the new password.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const fallback = type === "recovery" ? "/reset-password" : "/onboarding";
  const next = safeNext(url.searchParams.get("next"), fallback);
  const tokenHash = url.searchParams.get("token_hash");
  const code = url.searchParams.get("code");
  let error: { message: string } | null = null;
  try {
    const supabase = await createClient();
    if (tokenHash && type && OTP_TYPES.includes(type)) {
      ({ error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash }));
    } else if (code) {
      ({ error } = await supabase.auth.exchangeCodeForSession(code));
    } else {
      error = { message: "This link is incomplete." };
    }
  } catch (err) {
    error = { message: err instanceof Error ? err.message : String(err) };
  }

  if (error) {
    console.error("[auth/confirm] link failed:", error.message);
    const message =
      type === "recovery"
        ? "That password reset link has expired or was already used. Ask for a new one below."
        : "That link has expired or was already used. Log in to send a new verification email.";
    return NextResponse.redirect(new URL(`${type === "recovery" ? "/forgot-password" : "/login"}?error=${encodeURIComponent(message)}`, url.origin));
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
