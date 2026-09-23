"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PartyPopper, Loader2, CreditCard } from "lucide-react";
import { useOnboarding } from "@/lib/onboarding/context";
import { completeOnboardingAction } from "@/app/actions/onboarding";
import { startCheckoutAction } from "@/app/actions/billing";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function CompleteStep() {
  const router = useRouter();
  const { draft } = useOnboarding();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [startingCheckout, setStartingCheckout] = useState(false);

  async function handleSaveBusiness() {
    setSaving(true);
    setError(null);
    const result = await completeOnboardingAction(draft);
    setSaving(false);
    if (!result.success) { setError(result.error || "Something went wrong saving your business."); return; }
    setDemoMode(!!result.demoMode);
    setSaved(true);
  }

  async function handleStartTrial() {
    setStartingCheckout(true);
    setError(null);
    const result = await startCheckoutAction();
    setStartingCheckout(false);
    if (!result.url) { setError(result.error || "Could not start checkout."); return; }
    window.location.href = result.url;
  }

  return (
    <div className="animate-fade-up">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-soft text-brand-dark"><PartyPopper className="h-5 w-5" /></div>
      <h1 className="mt-4 font-display text-[24px] font-semibold text-ink">{draft.businessName || "You"}&apos;re almost live</h1>
      <p className="mt-1.5 text-[13.5px] text-text-muted">Save your setup, then start your free trial to get a phone number and go live.</p>

      <Card className="mt-8 p-5">
        <div className="text-[12px] font-semibold uppercase tracking-wide text-text-faint">Setup summary</div>
        <dl className="mt-3 space-y-2 text-[13px]">
          <div className="flex justify-between"><dt className="text-text-muted">Business</dt><dd className="font-medium text-text">{draft.businessName || "—"}</dd></div>
          <div className="flex justify-between"><dt className="text-text-muted">Receptionist</dt><dd className="font-medium text-text">{draft.receptionistName || "—"}</dd></div>
          <div className="flex justify-between"><dt className="text-text-muted">Voice</dt><dd className="font-medium text-text">{draft.customVoiceName || "Default"}</dd></div>
          <div className="flex justify-between"><dt className="text-text-muted">Menu items</dt><dd className="font-medium text-text">{draft.menuItems.length} added</dd></div>
        </dl>
      </Card>

      {error && <div className="mt-4 rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-3 text-[12.5px] text-danger">{error}</div>}

      {saved && !demoMode && (
        <Card className="mt-4 flex items-center justify-between p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-soft text-brand-dark"><CreditCard className="h-4.5 w-4.5" /></div>
            <div><div className="text-[13.5px] font-semibold text-ink">Start your free trial</div><div className="text-[12px] text-text-muted">7 days free, then $199/month. Cancel anytime.</div></div>
          </div>
          <Button size="sm" variant="brand" onClick={handleStartTrial} disabled={startingCheckout}>{startingCheckout ? "Starting…" : "Start free trial"}</Button>
        </Card>
      )}

      {saved && (
        <div className="mt-4 rounded-lg border border-success/20 bg-success-soft px-3.5 py-3 text-[12.5px] text-success">
          {demoMode ? "You're in demo mode (Supabase isn't connected), so nothing was saved — but everything below is wired up and ready." : "Your business is saved. Start your free trial above to get a phone number and go live — or head to your dashboard and do it later."}
        </div>
      )}

      <div className="mt-10 flex items-center justify-between border-t border-border pt-6">
        <span />
        {saved ? (
          <Button variant="outline" size="lg" onClick={() => router.push("/dashboard")}>Go to dashboard</Button>
        ) : (
          <Button variant="brand" size="lg" onClick={handleSaveBusiness} disabled={saving}>{saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : "Save & continue"}</Button>
        )}
      </div>
    </div>
  );
}
