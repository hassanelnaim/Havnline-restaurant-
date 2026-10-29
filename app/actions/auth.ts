"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { checkRateLimit, getClientIp, isRateLimited, recordRateLimitHit } from "@/lib/security/rateLimit";
import { createAdminClient } from "@/lib/supabase/admin";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/lib/legal/versions";
import { getSiteUrl } from "@/lib/env";

/** Where account email links land (app/auth/confirm/route.ts). */
const confirmUrl = (next: string) => `${getSiteUrl()}/auth/confirm?next=${encodeURIComponent(next)}`;

export async function signUpAction(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const fullName = formData.get("fullName") as string;
  const acceptedTerms = formData.get("acceptTerms") === "on";

  // Real server-side enforcement, not just the browser's checkbox —
  // the client-side "required" attribute is a UX nicety, but a direct
  // request could bypass it entirely. Terms acceptance is exactly the
  // kind of thing that shouldn't rely on trusting the client alone.
  if (!acceptedTerms) {
    redirect(`/signup?error=${encodeURIComponent("You must accept the Terms and Privacy Policy to create an account.")}`);
  }

  // Caps automated mass account creation from one network. Looser
  // than login's limits since a shared office/coffee-shop IP could
  // plausibly have a few real signups in an hour, just not dozens.
  const ip = await getClientIp();
  const ipOk = await checkRateLimit(`signup_ip:${ip}`, 5, 60);
  if (!ipOk) {
    redirect(`/signup?error=${encodeURIComponent("Too many signup attempts from this network. Please try again in a bit.")}`);
  }

  const supabase = await createClient();

  // Critical: sign out any existing session BEFORE creating the new
  // account. Without this, if someone is already logged in (e.g.
  // testing a second business while still logged into the first),
  // Supabase can create the new user for real but leave the browser's
  // session cookie pointed at the OLD account — meaning everything
  // done afterward gets silently attributed to whoever was already
  // logged in, not the new signup.
  await supabase.auth.signOut();

  const { data: signUpData, error } = await supabase.auth.signUp({
    email,
    password,
    // Without this, Supabase sends the verification link to its configured
    // "Site URL", which was never this site: the link opened a dead page.
    options: { data: { full_name: fullName }, emailRedirectTo: confirmUrl("/onboarding") },
  });

  if (error) {
    // Supabase can return a distinct "already registered" error here
    // (depending on the project's email-confirmation setting), which
    // would let anyone check whether a given email has an account just
    // by trying to sign up with it. Every other error (weak password,
    // bad email format, rate-limited) still shows Supabase's own
    // message, since only the duplicate-account case is enumeration-
    // sensitive.
    const isDuplicateEmail = /already registered|already exists|already in use/i.test(error.message);
    const message = isDuplicateEmail
      ? "If that email doesn't already have an account, check your inbox to finish signing up. Already have one? Try signing in instead."
      : error.message;
    redirect(`/signup?error=${encodeURIComponent(message)}`);
  }

  // Proof of what this account agreed to. A repeat signup for an existing
  // email comes back with no identities and isn't a new acceptance.
  const newUser = signUpData?.user;
  if (newUser && (newUser.identities?.length ?? 0) > 0) {
    try {
      const h = await headers();
      const { error: recordError } = await createAdminClient().from("terms_acceptances").insert({
        user_id: newUser.id,
        email: newUser.email ?? email,
        terms_version: TERMS_VERSION,
        privacy_version: PRIVACY_VERSION,
        ip,
        user_agent: (h.get("user-agent") || "").slice(0, 300),
      });
      if (recordError) console.error("[signup] could not record terms acceptance (run migration 040):", recordError.message);
    } catch (err) {
      console.error("[signup] could not record terms acceptance:", err);
    }
  }

  redirect(`/login?justSignedUp=1&email=${encodeURIComponent(email)}`);
}

/** Sends a new verification email (from the login page). Says the same thing whether or not the account exists. */
export async function resendVerificationAction(formData: FormData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const ip = await getClientIp();
  const ok = email && (await checkRateLimit(`verify_resend:${ip}`, 5, 60)) && (await checkRateLimit(`verify_resend:${email}`, 3, 60));
  if (ok) {
    const supabase = await createClient();
    const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: confirmUrl("/onboarding") } });
    if (error) console.error("[auth] could not resend the verification email:", error.message);
  }
  redirect(`/login?verifySent=1&email=${encodeURIComponent(email)}`);
}

export async function signInAction(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  // Two limits, not one: an IP limit alone lets an attacker who
  // rotates IPs still hammer one victim's account, and an email limit
  // alone lets an attacker with a botnet spray many accounts from one
  // machine without ever tripping it. Both together cover each gap.
  const ip = await getClientIp();
  const normalizedEmail = email?.trim().toLowerCase() || "";

  // Every attempt from one network counts; for one email, only FAILED
  // attempts count. Counting successes (and every attempt per email) let
  // anyone lock a real owner out by typing wrong passwords for their email.
  // Failures are limited per email+network (5) and per email overall (30),
  // so a stranger guessing can't block the owner's own network for long.
  const ipOk = await checkRateLimit(`login_ip:${ip}`, 20, 15);
  const [tooManyHere, tooManyOverall] = normalizedEmail
    ? await Promise.all([isRateLimited(`login_fail:${normalizedEmail}:${ip}`, 5, 15), isRateLimited(`login_fail:${normalizedEmail}`, 30, 15)])
    : [false, false];
  if (!ipOk || tooManyHere || tooManyOverall) {
    redirect(`/login?error=${encodeURIComponent("Too many sign-in attempts. Please wait a few minutes and try again.")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    if (normalizedEmail) {
      await Promise.all([recordRateLimitHit(`login_fail:${normalizedEmail}:${ip}`), recordRateLimitHit(`login_fail:${normalizedEmail}`)]);
    }
    // An unverified account gets its own message and a resend button.
    if (/email not confirmed/i.test(error.message)) {
      redirect(`/login?unverified=1&email=${encodeURIComponent(normalizedEmail)}`);
    }
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/dashboard");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
