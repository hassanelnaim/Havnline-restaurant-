"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { PhoneCall, MessageSquare, AudioLines, Copy, Check, Globe, Tablet, CreditCard } from "lucide-react";
import type { DbIntegration, IntegrationProvider } from "@/lib/database/types";
import { provisionPhoneNumberAction, changePhoneNumberAction } from "@/app/actions/business";
import { generatePrinterAppCodeAction, unpairPrinterAppAction } from "@/app/actions/printer-app";
import { startStripeConnectOnboardingAction } from "@/app/actions/payments";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IntegrationStatusBadge } from "@/components/dashboard/status-badges";

const PROVIDER_META: Record<IntegrationProvider, { name: string; description: string; icon: typeof PhoneCall }> = {
  twilio: { name: "Phone (Twilio)", description: "Powers your HavnLine phone number and inbound calls.", icon: PhoneCall },
  sms: { name: "SMS confirmations", description: "Sent automatically from your HavnLine number once you have one.", icon: MessageSquare },
  voice_provider: { name: "Order-taker voice", description: "Pick your AI's voice from AI Employee → Voice.", icon: AudioLines },
  printer_app: { name: "HavnLine Printer App", description: "Prints orders straight to your kitchen printer from a tablet.", icon: Tablet },
};

export function IntegrationsClient({
  initialIntegrations,
  stripeConnectAccountId,
  stripeConnectChargesEnabled,
  platformFeeBps,
}: {
  initialIntegrations: DbIntegration[];
  stripeConnectAccountId: string | null;
  stripeConnectChargesEnabled: boolean;
  platformFeeBps: number | null;
}) {
  const feePercent = platformFeeBps ? platformFeeBps / 100 : 0;
  const [integrations, setIntegrations] = useState(initialIntegrations);
  const [areaCode, setAreaCode] = useState("");
  const [provisioning, setProvisioning] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [, startTransition] = useTransition();

  const [onboarding, setOnboarding] = useState(false);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const stripeConnected = Boolean(stripeConnectAccountId);

  function handleStartStripeOnboarding() {
    setOnboarding(true);
    setPaymentsError(null);
    startTransition(async () => {
      const result = await startStripeConnectOnboardingAction();
      if (!result.url) {
        setOnboarding(false);
        setPaymentsError(result.error || "Could not start Stripe onboarding.");
        return;
      }
      window.location.href = result.url;
    });
  }

  const twilioIntegration = integrations.find((i) => i.provider === "twilio");
  const twilioConnected = twilioIntegration?.status === "connected";
  const phoneNumber = (twilioIntegration?.metadata as Record<string, unknown> | null)?.phone_number as string | undefined;

  const printerAppIntegration = integrations.find((i) => i.provider === "printer_app");
  const printerAppConnected = printerAppIntegration?.status === "connected";
  const printerAppMeta = printerAppIntegration?.metadata as { printer_ip?: string | null; last_seen_at?: string | null } | null;
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [unpairing, setUnpairing] = useState(false);
  const [printerAppError, setPrinterAppError] = useState<string | null>(null);

  function handleGeneratePrinterAppCode() {
    setGeneratingCode(true);
    setPrinterAppError(null);
    startTransition(async () => {
      const result = await generatePrinterAppCodeAction();
      setGeneratingCode(false);
      if (!result.success) { setPrinterAppError(result.error || "Could not generate a code."); return; }
      setPairingCode(result.code || null);
      setPairingExpiresAt(result.expiresAt || null);
    });
  }

  function handleUnpairPrinterApp() {
    setUnpairing(true);
    startTransition(async () => {
      await unpairPrinterAppAction();
      setUnpairing(false);
      setPairingCode(null);
      setIntegrations((prev) => prev.map((i) => (i.provider === "printer_app" ? { ...i, status: "not_connected", metadata: null, connected_at: null } : i)));
    });
  }

  // Requiring a real 3-digit area code here (not just trusting the
  // input's own digit-only formatting) means "Get a number" stays
  // disabled rather than silently falling through to `undefined` and
  // provisioning a number in a random area code the business didn't
  // choose. The server action enforces this too, so this is purely
  // about not letting the button be clickable in the first place.
  const areaCodeValid = /^\d{3}$/.test(areaCode);

  function handleGetNumber() {
    if (!areaCodeValid) { setPhoneError("Enter a 3-digit area code before requesting a number."); return; }
    setProvisioning(true);
    setPhoneError(null);
    startTransition(async () => {
      const result = await provisionPhoneNumberAction(areaCode);
      setProvisioning(false);
      if (!result.success) { setPhoneError(result.error || "Could not provision a number."); return; }
      setIntegrations((prev) => prev.map((i) => (i.provider === "twilio" ? { ...i, status: "connected", metadata: { phone_number: result.phoneNumber } } : i)));
    });
  }

  function handleChangeNumber() {
    if (!areaCodeValid) { setPhoneError("Enter a 3-digit area code before requesting a new number."); return; }
    setProvisioning(true);
    setPhoneError(null);
    startTransition(async () => {
      const result = await changePhoneNumberAction(areaCode);
      setProvisioning(false);
      if (!result.success) { setPhoneError(result.error || "Could not provision a new number."); return; }
      setIntegrations((prev) => prev.map((i) => (i.provider === "twilio" ? { ...i, status: "connected", metadata: { phone_number: result.phoneNumber } } : i)));
    });
  }

  function copyNumber() {
    if (!phoneNumber) return;
    navigator.clipboard.writeText(phoneNumber);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const commsIntegrations = integrations.filter((i) => i.provider === "twilio" || i.provider === "sms" || i.provider === "voice_provider");

  function renderCard(integration: DbIntegration) {
    const meta = PROVIDER_META[integration.provider];
    const Icon = meta.icon;
    const phoneNum = integration.provider === "twilio" ? (integration.metadata as Record<string, unknown> | null)?.phone_number : null;

    return (
      <Card key={integration.id}>
        <CardContent className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-paper text-text-muted"><Icon className="h-4.5 w-4.5" /></div>
            <div>
              <div className="text-[13.5px] font-semibold text-ink">{meta.name}</div>
              <p className="mt-0.5 text-[12px] text-text-muted">{phoneNum ? `Your number: ${phoneNum}` : meta.description}</p>
              <div className="mt-2"><IntegrationStatusBadge status={integration.status} /></div>
            </div>
          </div>

          {integration.provider === "twilio" ? (
            <div className="flex flex-col items-end gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor="area-code-input" className={`text-[11px] font-semibold ${areaCodeValid ? "text-text-muted" : "text-amber-600"}`}>
                    Area code <span className="text-amber-600">*</span>
                  </label>
                  <Input
                    id="area-code-input"
                    placeholder="e.g. 313"
                    value={areaCode}
                    onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, "").slice(0, 3))}
                    className={`w-24 ${areaCodeValid ? "" : "border-2 border-amber-400 bg-amber-50 placeholder:text-amber-400 focus-visible:ring-amber-400"}`}
                  />
                </div>
                <Button size="sm" variant={twilioConnected ? "outline" : "brand"} onClick={twilioConnected ? handleChangeNumber : handleGetNumber} disabled={provisioning || !areaCodeValid} title={areaCodeValid ? undefined : "Enter a 3-digit area code first"}>
                  {provisioning ? "Working…" : twilioConnected ? "New number" : "Get a number"}
                </Button>
              </div>
              {!areaCodeValid && <p className="text-[11px] font-medium text-amber-600">Enter a 3-digit area code first</p>}
            </div>
          ) : integration.provider === "voice_provider" ? (
            <Button size="sm" variant="outline" asChild><Link href="/dashboard/ai-employee">Choose voice</Link></Button>
          ) : integration.provider === "sms" ? (
            <span className="text-[12px] text-text-faint">{integration.status === "connected" ? "Automatic" : "Needs a phone number first"}</span>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {phoneError && <div className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{phoneError}</div>}

      <div>
        <h3 className="mb-2.5 text-[12px] font-semibold uppercase tracking-wide text-text-faint">Kitchen &amp; payments</h3>
        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <CardContent className="flex flex-wrap items-start justify-between gap-4 p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-paper text-text-muted"><Tablet className="h-4.5 w-4.5" /></div>
                <div>
                  <div className="text-[13.5px] font-semibold text-ink">HavnLine Printer App</div>
                  <p className="mt-0.5 max-w-md text-[12px] text-text-muted">Install the HavnLine app on any Android tablet and it'll print orders straight to your kitchen printer.</p>
                  <div className="mt-2">{printerAppIntegration && <IntegrationStatusBadge status={printerAppIntegration.status} />}</div>
                </div>
              </div>
              {printerAppConnected ? (
                <Button size="sm" variant="ghost" onClick={handleUnpairPrinterApp} disabled={unpairing}>{unpairing ? "Removing…" : "Unpair tablet"}</Button>
              ) : (
                <Button size="sm" variant="brand" onClick={handleGeneratePrinterAppCode} disabled={generatingCode}>{generatingCode ? "Generating…" : "Get pairing code"}</Button>
              )}
            </CardContent>

            {printerAppError && <CardContent className="border-t border-border-soft pt-3 text-[12.5px] text-danger">{printerAppError}</CardContent>}

            {pairingCode && !printerAppConnected && (
              <CardContent className="border-t border-border-soft pt-4">
                <p className="text-[12px] text-text-muted">Open the HavnLine app on your tablet and enter this code — it expires in 15 minutes:</p>
                <div className="mt-2 inline-block rounded-lg border border-border bg-paper px-4 py-2 font-mono text-[22px] font-semibold tracking-[0.2em] text-ink">{pairingCode}</div>
                {pairingExpiresAt && <p className="mt-1.5 text-[11px] text-text-faint">Expires at {new Date(pairingExpiresAt).toLocaleTimeString()}</p>}
              </CardContent>
            )}

            {printerAppConnected && (
              <CardContent className="border-t border-border-soft pt-3 text-[12.5px] text-text-muted">
                {printerAppMeta?.printer_ip ? `Printer: ${printerAppMeta.printer_ip}` : "Waiting for the tablet to report its printer's IP address (set this up in the app)."}
                {printerAppMeta?.last_seen_at && <span> · Last checked in {new Date(printerAppMeta.last_seen_at).toLocaleString()}</span>}
              </CardContent>
            )}
          </Card>

          <Card>
            <CardContent className="flex flex-wrap items-start justify-between gap-4 p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-paper text-text-muted"><CreditCard className="h-4.5 w-4.5" /></div>
                <div>
                  <div className="text-[13.5px] font-semibold text-ink">Stripe Connect</div>
                  <p className="mt-0.5 max-w-md text-[12px] text-text-muted">
                    {stripeConnectChargesEnabled
                      ? feePercent > 0
                        ? "Connected — payments from phone orders go to your own bank account, minus HavnLine's fee below."
                        : "Connected — payments from phone orders go straight to your own bank account."
                      : stripeConnected
                      ? "Onboarding started but not finished yet — Stripe still needs a bit more from you before you can accept charges."
                      : "Let customers pay by card over the phone. Money goes directly to your own Stripe account."}
                  </p>
                  <div className="mt-2">
                    <IntegrationStatusBadge status={stripeConnectChargesEnabled ? "connected" : "not_connected"} />
                  </div>
                </div>
              </div>
              <Button size="sm" variant={stripeConnectChargesEnabled ? "outline" : "brand"} onClick={handleStartStripeOnboarding} disabled={onboarding}>
                {onboarding ? "Redirecting…" : stripeConnectChargesEnabled ? "Manage on Stripe" : stripeConnected ? "Finish onboarding" : "Connect Stripe"}
              </Button>
            </CardContent>

            {feePercent > 0 && (
              <CardContent className="border-t border-border-soft pt-4">
                <div className="flex items-center justify-between gap-4 rounded-xl border border-brand/20 bg-brand-soft px-4 py-3">
                  <div>
                    <div className="text-[13.5px] font-semibold text-ink">HavnLine takes {feePercent}% of every phone-order payment</div>
                    <p className="mt-0.5 text-[12px] text-text-muted">Deducted automatically at checkout — you never get billed separately for it. A $50 order pays you ${(50 - 50 * (feePercent / 100)).toFixed(2)}.</p>
                  </div>
                </div>
              </CardContent>
            )}

            {paymentsError && <CardContent className="border-t border-border-soft pt-3 text-[12.5px] text-danger">{paymentsError}</CardContent>}

            <CardContent className="border-t border-border-soft pt-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[13px] font-medium text-ink">Payment over the phone</div>
                  <p className="mt-0.5 text-[12px] text-text-muted">
                    {stripeConnectChargesEnabled
                      ? "Required on every phone order — the AI texts a payment link after confirming the order, and the kitchen ticket prints once it's paid."
                      : "Every phone order requires payment up front — finish connecting Stripe above so your AI can actually take orders."}
                  </p>
                </div>
                <IntegrationStatusBadge status={stripeConnectChargesEnabled ? "connected" : "not_connected"} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div>
        <h3 className="mb-2.5 text-[12px] font-semibold uppercase tracking-wide text-text-faint">Phone</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{commsIntegrations.map(renderCard)}</div>

        {phoneNumber && (
          <Card className="mt-3">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 text-[13.5px] font-semibold text-ink"><Globe className="h-4 w-4 text-text-faint" /> Keep your current business number</div>
              <p className="mt-2 text-[13px] leading-relaxed text-text">Customers can keep calling the number they already know — just forward it to your HavnLine number.</p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
                <span>Forward calls to</span>
                <button onClick={copyNumber} className="flex items-center gap-1.5 rounded-lg border border-border bg-paper px-2.5 py-1 font-mono text-[12.5px]">
                  {phoneNumber} {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3 text-text-faint" />}
                </button>
              </div>
              <div className="mt-4 rounded-lg border border-border bg-paper px-4 py-3 text-[13px] leading-relaxed text-text">
                <div className="mb-2 font-semibold text-text">How to set up forwarding</div>
                <p>This is a setting on your <em>existing</em> phone line — every carrier does it slightly differently. Find yours below:</p>
                <ul className="mt-3 space-y-3 text-[13px] leading-relaxed text-text">
                  <li><span className="font-semibold">- Verizon or US Cellular:</span> dial <code className="rounded bg-border-soft px-1.5 py-0.5 font-mono text-[12px]">*72</code> followed by your HavnLine number, then call. To turn off, dial <code className="rounded bg-border-soft px-1.5 py-0.5 font-mono text-[12px]">*73</code>.</li>
                  <li><span className="font-semibold">- AT&amp;T:</span> dial <code className="rounded bg-border-soft px-1.5 py-0.5 font-mono text-[12px]">*21*</code> + number + <code className="rounded bg-border-soft px-1.5 py-0.5 font-mono text-[12px]">#</code>, then call. Off: <code className="rounded bg-border-soft px-1.5 py-0.5 font-mono text-[12px]">##21#</code>.</li>
                  <li><span className="font-semibold">- T-Mobile:</span> dial <code className="rounded bg-border-soft px-1.5 py-0.5 font-mono text-[12px]">**21*</code> + number + <code className="rounded bg-border-soft px-1.5 py-0.5 font-mono text-[12px]">#</code>. Off: <code className="rounded bg-border-soft px-1.5 py-0.5 font-mono text-[12px]">##21#</code>.</li>
                  <li><span className="font-semibold">- Landline/business system:</span> use your provider's call forwarding settings.</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}