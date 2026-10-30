"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useOnboarding } from "@/lib/onboarding/context";
import { createBusinessDraftAction } from "@/app/actions/business-draft";
import { StepShell } from "@/components/onboarding/step-shell";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RESTAURANT_TYPES } from "@/lib/restaurant-types";

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

  const canContinue =
    draft.businessName.trim().length > 0 &&
    draft.phone.trim().length > 0 &&
    draft.addressCity.trim().length > 0 &&
    /^[A-Za-z]{2}$/.test(draft.addressState.trim()) &&
    draft.addressZip.trim().length > 0 &&
    draft.entityType !== "" &&
    draft.legalBusinessName.trim().length > 0;

  async function handleContinue() {
    setSaving(true);
    setError(null);
    const result = await createBusinessDraftAction({
      businessName: draft.businessName, businessType: draft.businessType, address: draft.address, addressCity: draft.addressCity, addressState: draft.addressState, addressZip: draft.addressZip, phone: draft.phone, description: draft.description, timezone: draft.timezone, legalBusinessName: draft.legalBusinessName, ein: draft.ein, entityType: draft.entityType,
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
            {RESTAURANT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="address">Address</Label>
          <Input id="address" className="mt-1.5" placeholder="412 Riverside Pkwy, Millbrook, NY" value={draft.address} onChange={(e) => update({ address: e.target.value })} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="addressCity">City</Label>
            <Input id="addressCity" className="mt-1.5" placeholder="Millbrook" value={draft.addressCity} onChange={(e) => update({ addressCity: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="addressState">State</Label>
            <Input id="addressState" className="mt-1.5" maxLength={2} placeholder="NY" value={draft.addressState} onChange={(e) => update({ addressState: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="addressZip">ZIP</Label>
            <Input id="addressZip" className="mt-1.5" placeholder="12545" value={draft.addressZip} onChange={(e) => update({ addressZip: e.target.value })} />
          </div>
        </div>
        <p className="text-[12px] text-text-faint">We use your city, state and ZIP to automatically calculate the right sales tax on every order — no manual tax rate to set up or maintain.</p>
        <div>
          <Label htmlFor="phone">Restaurant phone</Label>
          <Input id="phone" className="mt-1.5" placeholder="(845) 555-0142" value={draft.phone} onChange={(e) => update({ phone: e.target.value })} />
        </div>
        <fieldset className="rounded-xl border border-border p-4">
          <legend className="px-1 text-[13px] font-medium text-ink">Business registration</legend>
          <p className="text-[12px] text-text-faint">
            Phone carriers only deliver texts (like your customers&apos; payment links) from registered businesses. HavnLine registers you; we need these exactly as the IRS has them. They&apos;re stored encrypted and never shown to customers.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Does your restaurant have an EIN?">
            {([
              { value: "business", title: "We have an EIN", sub: "LLC, corporation, partnership, or a sole proprietor with an EIN" },
              { value: "sole_proprietor", title: "No EIN", sub: "Sole proprietor using your Social Security number" },
            ] as const).map((o) => (
              <label key={o.value} className={`flex cursor-pointer gap-2.5 rounded-lg border px-3 py-2.5 ${draft.entityType === o.value ? "border-brand bg-brand-soft" : "border-border hover:border-text-faint"}`}>
                <input type="radio" name="entityType" value={o.value} className="mt-0.5 h-4 w-4 shrink-0 accent-brand" checked={draft.entityType === o.value} onChange={() => update({ entityType: o.value })} />
                <span>
                  <span className="block text-[13px] font-medium text-ink">{o.title}</span>
                  <span className="block text-[11.5px] text-text-muted">{o.sub}</span>
                </span>
              </label>
            ))}
          </div>

          {draft.entityType === "business" && (
            <div className="mt-4 space-y-4">
              <div>
                <Label htmlFor="legalBusinessName">Legal business name</Label>
                <Input id="legalBusinessName" className="mt-1.5" placeholder="Riverside Pizza Co. LLC" value={draft.legalBusinessName} onChange={(e) => update({ legalBusinessName: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="ein">EIN</Label>
                <Input id="ein" className="mt-1.5" inputMode="numeric" autoComplete="off" maxLength={10} placeholder="12-3456789" value={draft.ein} onChange={(e) => update({ ein: e.target.value })} />
                <p className="mt-1.5 text-[12px] text-text-faint">Your federal tax ID, on your IRS letter (CP 575) or last tax return. Already entered it before? You can leave this blank.</p>
              </div>
            </div>
          )}

          {draft.entityType === "sole_proprietor" && (
            <div className="mt-4 space-y-2">
              <Label htmlFor="legalBusinessName">Your full legal name</Label>
              <Input id="legalBusinessName" className="mt-1.5" placeholder="Maria Lopez" autoComplete="name" value={draft.legalBusinessName} onChange={(e) => update({ legalBusinessName: e.target.value })} />
              <p className="text-[12px] text-text-faint">
                Carriers register businesses without an EIN under the owner&apos;s name and send a one-time code to the owner&apos;s mobile phone to confirm it; we&apos;ll reach out when it&apos;s time. If you get an EIN later (free at irs.gov), you can add it under Integrations.
              </p>
            </div>
          )}
        </fieldset>
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
