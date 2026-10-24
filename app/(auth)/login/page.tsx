import Link from "next/link";
import { signInAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";

export default async function LoginPage(
  props: { searchParams: Promise<{ error?: string; justSignedUp?: string }> }
) {
  const searchParams = await props.searchParams;
  return (
    <div>
      <h1 className="font-display text-[22px] font-semibold text-ink">Log in</h1>
      <p className="mt-1 text-[13px] text-text-muted">Welcome back.</p>

      {searchParams.justSignedUp && (
        <div className="mt-4 rounded-lg border border-success/20 bg-success-soft px-3.5 py-2.5 text-[12.5px] text-success">
          Account created — log in to continue.
        </div>
      )}
      {searchParams.error && (
        <div className="mt-4 rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">
          {searchParams.error}
        </div>
      )}

      <form action={signInAction} className="mt-6 space-y-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <PasswordInput id="password" name="password" required className="mt-1.5" />
        </div>
        <Button type="submit" variant="brand" className="w-full">Log in</Button>
      </form>

      <p className="mt-5 text-center text-[13px] text-text-muted">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="font-medium text-brand hover:underline">Sign up</Link>
      </p>
    </div>
  );
}
