"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // An expired reset link sends people back here with a message.
  useEffect(() => {
    const message = new URLSearchParams(window.location.search).get("error");
    if (message) setError(message);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/confirm?next=/reset-password` });
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  }

  return (
    <div>
      <h1 className="font-display text-[22px] font-semibold text-ink">Reset your password</h1>
      {sent ? (
        <p className="mt-4 text-[13.5px] text-text-muted">Check your email for a reset link.</p>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {error && <div className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{error}</div>}
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required className="mt-1.5" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <Button type="submit" variant="brand" className="w-full">Send reset link</Button>
        </form>
      )}
      <p className="mt-5 text-center text-[13px] text-text-muted">
        <Link href="/login" className="font-medium text-brand hover:underline">Back to login</Link>
      </p>
    </div>
  );
}
