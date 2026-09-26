"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useOnboarding } from "@/lib/onboarding/context";
import { createBusinessDraftAction } from "@/app/actions/business-draft";
import { StepShell } from "@/components/onboarding/step-shell";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

// Restaurant sub-types only — HavnLine is restaurant-specific, not a
// generic "AI receptionist for any business" product. These are real
// categories a restaurant owner would pick, not filler.
const BUSINESS_TYPES = ["Quick Service", "Fast Casual", "Casual Dining", "Fine Dining", "Cafe & Bakery", "Bar & Grill", "Food Truck", "Pizzeria", "Other"];

// Curated rather than the full IANA list — every real timezone a small
// US-based business is actually in, labeled the way a business owner
// thinks about it rather than by raw zone id.
const TIMEZONES = [
  { value: "America/New_York", label: "Eastern Time (ET)" },
  { value: "America/Chicago", label: "Central Time (CT)" },
  { value: "America/Denver", label: "Mountain Time (MT)" },
  { value: "America/Phoenix", label: "Arizona (no DST)" },
  { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
  { value: "America/Anchorage", label: "Alaska Time (AKT)" },
  { value: "Pacific/Honolulu", label: "Hawaii Time (HT)" },
];

export default function BusinessInfoStep() {
  const router = useRouter();
  const { draft, update } = useOnboarding();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canContinue = draft.businessName.trim().length > 0 && draft.phone.trim().length > 0;

  async function handleContinue() {
    setSaving(true);
    setError(null);
    const result = await createBusinessDraftAction({
      businessName: draft.businessName, businessType: draft.businessType, address: draft.address, phone: draft.phone, description: draft.description, timezone: draft.timezone,
    });
    setSaving(false);

    if (!result.success) {
      setError(result.error || "Could not save your business info.");
      return;
    }
    if (result.businessId) update({ businessId: result.businessId });
    router.push("/onboarding/hours");
  }

  return (
    <StepShell title="Tell us about your restaurant" description="This is what your AI order-taker will introduce itself with." onContinue={handleContinue} continueDisabled={!canContinue || saving} continueLabel={saving ? "Saving…" : "Continue"}>
      <div className="space-y-5">
        {error && <div className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{error}</div>}
        <div>
          <Label htmlFor="businessName">Restaurant name</Label>
          <Input id="businessName" className="mt-1.5" placeholder="Riverside Pizza Co." value={draft.businessName} onChange={(e) => update({ businessName: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="businessType">Restaurant type</Label>
          <select id="businessType" className="mt-1.5 flex h-9 w-full rounded-lg border border-border bg-card px-3 text-[13.5px] text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30" value={draft.businessType} onChange={(e) => update({ businessType: e.target.value })}>
            <option value="">Select a type…</option>
            {BUSINESS_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="address">Address</Label>
          <Input id="address" className="mt-1.5" placeholder="412 Riverside Pkwy, Millbrook, NY" value={draft.address} onChange={(e) => update({ address: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="phone">Restaurant phone</Label>
          <Input id="phone" className="mt-1.5" placeholder="(845) 555-0142" value={draft.phone} onChange={(e) => update({ phone: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="timezone">Timezone</Label>
          <select id="timezone" className="mt-1.5 flex h-9 w-full rounded-lg border border-border bg-card px-3 text-[13.5px] text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30" value={draft.timezone} onChange={(e) => update({ timezone: e.target.value })}>
            {TIMEZONES.map((tz) => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
          </select>
          <p className="mt-1.5 text-[12px] text-text-faint">We pre-selected this from your browser — double check it's where your restaurant actually operates, since your AI order-taker uses it to know your real business hours.</p>
        </div>
        <div>
          <Label htmlFor="description">Restaurant description</Label>
          <Textarea id="description" rows={3} className="mt-1.5" placeholder="A family-owned pizzeria known for our brick-oven pies and garlic knots…" value={draft.description} onChange={(e) => update({ description: e.target.value })} />
        </div>
      </div>
    </StepShell>
  );
}
