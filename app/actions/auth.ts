"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/security/rateLimit";

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
  const ip = getClientIp();
  const ipOk = await checkRateLimit(`signup_ip:${ip}`, 5, 60);
  if (!ipOk) {
    redirect(`/signup?error=${encodeURIComponent("Too many signup attempts from this network. Please try again in a bit.")}`);
  }

  const supabase = createClient();

  // Critical: sign out any existing session BEFORE creating the new
  // account. Without this, if someone is already logged in (e.g.
  // testing a second business while still logged into the first),
  // Supabase can create the new user for real but leave the browser's
  // session cookie pointed at the OLD account — meaning everything
  // done afterward gets silently attributed to whoever was already
  // logged in, not the new signup.
  await supabase.auth.signOut();

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });

  if (error) {
    redirect(`/signup?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/login?justSignedUp=1");
}

export async function signInAction(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  // Two limits, not one: an IP limit alone lets an attacker who
  // rotates IPs still hammer one victim's account, and an email limit
  // alone lets an attacker with a botnet spray many accounts from one
  // machine without ever tripping it. Both together cover each gap.
  const ip = getClientIp();
  const normalizedEmail = email?.trim().toLowerCase();
  const ipOk = await checkRateLimit(`login_ip:${ip}`, 10, 15);
  const emailOk = normalizedEmail ? await checkRateLimit(`login_email:${normalizedEmail}`, 5, 15) : true;
  if (!ipOk || !emailOk) {
    redirect(`/login?error=${encodeURIComponent("Too many sign-in attempts. Please wait a few minutes and try again.")}`);
  }

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/dashboard");
}

export async function signOutAction() {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
