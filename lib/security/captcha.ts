/**
 * Bot check (Cloudflare Turnstile) on every form that creates an account,
 * signs in or sends an email: sign-up, log-in, resend verification,
 * forgot password, and the current-password check in Settings.
 *
 * Supabase does the verifying. With "Enable CAPTCHA protection" turned on
 * (Authentication → Attack Protection, provider Turnstile, with the secret
 * key), Supabase refuses sign-ups, sign-ins and auth emails without a valid
 * token, including requests sent straight to Supabase with the public key,
 * which never pass through this site's forms or rate limits.
 *
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY shows the check on the forms. Deploy with
 * it set BEFORE turning protection on in Supabase, or every sign-in fails.
 */
export const TURNSTILE_SITE_KEY = (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "").trim();

export const captchaEnabled = () => TURNSTILE_SITE_KEY.length > 0;

/** The token a form sent, if any. */
export function captchaTokenFrom(formData: FormData): string | undefined {
  const token = String(formData.get("captchaToken") || formData.get("cf-turnstile-response") || "").trim();
  return token || undefined;
}

export const CAPTCHA_MISSING = "Please complete the security check, then try again.";

/** Supabase's wording for a missing, used or expired token, turned into something a person can act on. */
export function isCaptchaError(message: string): boolean {
  return /captcha/i.test(message);
}
