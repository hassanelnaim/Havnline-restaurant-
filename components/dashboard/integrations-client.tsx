"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { UtensilsCrossed, PhoneCall, MessageSquare, AudioLines, Copy, Check, Globe, RefreshCw } from "lucide-react";
import type { DbIntegration, IntegrationProvider } from "@/lib/database/types";
import { provisionPhoneNumberAction, changePhoneNumberAction } from "@/app/actions/business";
import { connectSpotOnAction, disconnectSpotOnAction, syncSpotOnMenuAction } from "@/app/actions/spoton";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IntegrationStatusBadge } from "@/components/dashboard/status-badges";

const PROVIDER_META: Record<IntegrationProvider, { name: string; description: string; icon: typeof UtensilsCrossed }> = {
  spoton: { name: "SpotOn POS", description: "Sends orders your AI takes straight to your kitchen printer.", icon: UtensilsCrossed },
  twilio: { name: "Phone (Twilio)", description: "Powers your HavnLine phone number and inbound calls.", icon: PhoneCall },
  sms: { name: "SMS confirmations", description: "Sent automatically from your HavnLine number once you have one.", icon: MessageSquare },
  voice_provider: { name: "Order-taker voice", description: "Pick your AI's voice from AI Employee → Voice.", icon: AudioLines },
};

export function IntegrationsClient({ initialIntegrations, spotonError }: { initialIntegrations: DbIntegration[]; spotonError?: boolean }) {
  const [integrations, setIntegrations] = useState(initialIntegrations);
  const [areaCode, setAreaCode] = useState("");
  const [provisioning, setProvisioning] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [, startTransition] = useTransition();

  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const twilioIntegration = integrations.find((i) => i.provider === "twilio");
  const twilioConnected = twilioIntegration?.status === "connected";
  const phoneNumber = (twilioIntegration?.metadata as Record<string, unknown> | null)?.phone_number as string | undefined;

  const spotonIntegration = integrations.find((i) => i.provider === "spoton");
  const spotonConnected = spotonIntegration?.status === "connected";

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

  function handleDisconnectSpotOn() {
    startTransition(async () => {
      await disconnectSpotOnAction();
      setIntegrations((prev) => prev.map((i) => (i.provider === "spoton" ? { ...i, status: "not_connected" } : i)));
    });
  }

  function handleSyncMenu() {
    setSyncing(true);
    setSyncMsg(null);
    startTransition(async () => {
      const result = await syncSpotOnMenuAction();
      setSyncing(false);
      setSyncMsg(result.success ? `Synced ${result.itemCount} item${result.itemCount === 1 ? "" : "s"} from SpotOn.` : result.error || "Sync failed.");
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
      {spotonError && (
        <div className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">
          SpotOn isn&apos;t set up on this app yet — it needs SpotOn developer API credentials before anyone can connect. Apply for API access at{" "}
          <a href="https://www.spoton.com/developer-center/" target="_blank" rel="noreferrer" className="underline">spoton.com/developer-center</a>, then add the credentials to get this working.
        </div>
      )}

      <div>
        <h3 className="mb-2.5 text-[12px] font-semibold uppercase tracking-wide text-text-faint">Point of sale</h3>
        <Card>
          <CardContent className="flex flex-wrap items-start justify-between gap-4 p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-paper text-text-muted"><UtensilsCrossed className="h-4.5 w-4.5" /></div>
              <div>
                <div className="text-[13.5px] font-semibold text-ink">SpotOn POS</div>
                <p className="mt-0.5 max-w-md text-[12px] text-text-muted">This is what lets an order your AI takes reach your kitchen printer — the same path your existing online orders already take.</p>
                <div className="mt-2">{spotonIntegration && <IntegrationStatusBadge status={spotonIntegration.status} />}</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {spotonConnected ? (
                <>
                  <Button size="sm" variant="outline" onClick={handleSyncMenu} disabled={syncing}><RefreshCw className="h-3.5 w-3.5" /> {syncing ? "Syncing…" : "Sync menu"}</Button>
                  <Button size="sm" variant="ghost" onClick={handleDisconnectSpotOn}>Disconnect</Button>
                </>
              ) : (
                <form action={connectSpotOnAction}>
                  <Button size="sm" variant="brand" type="submit">Connect SpotOn</Button>
                </form>
              )}
            </div>
          </CardContent>
          {syncMsg && <CardContent className="border-t border-border-soft pt-3 text-[12.5px] text-text-muted">{syncMsg}</CardContent>}
        </Card>
      </div>

      <div>
        <h3 className="mb-2.5 text-[12px] font-semibold uppercase tracking-wide text-text-faint">Phone, SMS &amp; Voice</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{commsIntegrations.map(renderCard)}</div>
      </div>

      {phoneNumber && (
        <Card>
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

      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 text-[13.5px] font-semibold text-ink"><Globe className="h-4 w-4 text-text-faint" /> Import knowledge from your website</div>
          <p className="mt-2 text-[13px] text-text-muted">Manage this from Knowledge → Import. For your menu specifically, use the Menu page.</p>
          <Button size="sm" variant="outline" className="mt-3" asChild><Link href="/dashboard/knowledge">Go to Knowledge → Import</Link></Button>
        </CardContent>
      </Card>
    </div>
  );
}