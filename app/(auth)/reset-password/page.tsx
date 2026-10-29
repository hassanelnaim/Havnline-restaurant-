"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";

/** Reached from a password reset email (via /auth/confirm, which signs the person in). */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("The two passwords don't match.");
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      setError(/session|not authenticated|jwt/i.test(error.message) ? "This reset link has expired. Ask for a new one." : error.message);
      return;
    }
    router.push("/dashboard");
  }

  return (
    <div>
      <h1 className="font-display text-[22px] font-semibold text-ink">Choose a new password</h1>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        {error && <div className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{error}</div>}
        <div>
          <Label htmlFor="password">New password</Label>
          <PasswordInput id="password" required className="mt-1.5" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </div>
        <div>
          <Label htmlFor="confirm">Type it again</Label>
          <PasswordInput id="confirm" required className="mt-1.5" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </div>
        <Button type="submit" variant="brand" className="w-full" disabled={saving}>{saving ? "Saving…" : "Save new password"}</Button>
      </form>
      <p className="mt-5 text-center text-[13px] text-text-muted">
        <Link href="/forgot-password" className="font-medium text-brand hover:underline">Need a new reset link?</Link>
      </p>
    </div>
  );
}
