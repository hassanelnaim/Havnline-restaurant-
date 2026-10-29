import Link from "next/link";
import { signUpAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Turnstile } from "@/components/auth/turnstile";
import { HONEYPOT_FIELD } from "@/lib/security/signupGuard";

export default async function SignupPage(props: { searchParams: Promise<{ error?: string }> }) {
  const searchParams = await props.searchParams;
  return (
    <div>
      <h1 className="font-display text-[22px] font-semibold text-ink">Create your account</h1>
      <p className="mt-1 text-[13px] text-text-muted">Set up your AI order-taker in an afternoon.</p>

      {searchParams.error && (
        <div className="mt-4 rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">
          {searchParams.error}
        </div>
      )}

      <form action={signUpAction} className="mt-6 space-y-4">
        {/* Hidden from people (and screen readers); bots fill every field. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label htmlFor={HONEYPOT_FIELD}>Company website</label>
          <input id={HONEYPOT_FIELD} name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
        </div>
        <div>
          <Label htmlFor="fullName">Full name</Label>
          <Input id="fullName" name="fullName" required className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <PasswordInput id="password" name="password" required minLength={8} className="mt-1.5" />
        </div>
        <div className="flex items-start gap-2.5">
          <input id="acceptTerms" name="acceptTerms" type="checkbox" required className="mt-0.5 h-4 w-4 rounded border-border text-brand focus:ring-2 focus:ring-brand/30" />
          <label htmlFor="acceptTerms" className="text-[12.5px] leading-relaxed text-text-muted">
            I agree to HavnLine's{" "}
            <Link href="/terms" target="_blank" className="font-medium text-brand hover:underline">Terms</Link>{" "}
            and{" "}
            <Link href="/privacy" target="_blank" className="font-medium text-brand hover:underline">Privacy Policy</Link>.
          </label>
        </div>
        <Turnstile key={searchParams.error || "signup"} />
        <Button type="submit" variant="brand" className="w-full">Create account</Button>
      </form>

      <p className="mt-5 text-center text-[13px] text-text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-brand hover:underline">Log in</Link>
      </p>
    </div>
  );
}
