"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { PhoneCall, MessageSquare, Copy, Check, Tablet, CreditCard, PhoneForwarded, CheckCircle2, Circle, AlertCircle, ArrowRight } from "lucide-react";
import type { DbIntegration } from "@/lib/database/types";
import { provisionPhoneNumberAction, changePhoneNumberAction, saveTextingIdentityAction } from "@/app/actions/business";
import { generatePrinterAppCodeAction, unpairPrinterAppAction } from "@/app/actions/printer-app";
import { startStripeConnectOnboardingAction } from "@/app/actions/payments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// A tablet that hasn't checked in for this long is probably closed or off.
const TABLET_STALE_MS = 10 * 60_000;

type Tone = "success" | "warning" | "neutral";

const TONE_CLASSES: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-amber-50 text-amber-700",
  neutral: "bg-border-soft text-text-muted",
};

function StatusPill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${TONE_CLASSES[tone]}`}>{children}</span>;
}

function CardShell({ id, icon: Icon, title, subtitle, status, children, className = "" }: {
  id?: string;
  icon: typeof PhoneCall;
  title: string;
  subtitle?: string;
  status: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`flex scroll-mt-24 flex-col rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6 ${className}`}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-dark"><Icon className="h-[18px] w-[18px]" /></div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[15px] font-semibold text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[12px] text-text-faint">{subtitle}</p>}
        </div>
        {status}
      </div>
      <div className="mt-4 flex flex-1 flex-col">{children}</div>
    </section>
  );
}

/** +13133705341 -> (313) 370-5341 */
function formatPhone(e164: string): string {
  const d = e164.replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164;
}

function timeAgo(iso: string, now: number): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  function copy(key: string, text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  }
  return { copied, copy };
}

type Carrier = "verizon" | "att" | "tmobile" | "other";
const CARRIERS: { id: Carrier; label: string }[] = [
  { id: "verizon", label: "Verizon / US Cellular" },
  { id: "att", label: "AT&T" },
  { id: "tmobile", label: "T-Mobile" },
  { id: "other", label: "Landline / other" },
];

function forwardingCodes(carrier: Carrier, digits10: string): { on: string; off: string } | null {
  switch (carrier) {
    case "verizon": return { on: `*72${digits10}`, off: "*73" };
    case "att": return { on: `*21*${digits10}#`, off: "##21#" };
    case "tmobile": return { on: `**21*1${digits10}#`, off: "##21#" };
    default: return null;
  }
}

export function IntegrationsClient({
  initialIntegrations,
  stripeConnectAccountId,
  stripeConnectChargesEnabled,
  platformFeeBps,
  textingIdentity,
}: {
  initialIntegrations: DbIntegration[];
  stripeConnectAccountId: string | null;
  stripeConnectChargesEnabled: boolean;
  platformFeeBps: number | null;
  textingIdentity: { legalBusinessName: string | null; hasEin: boolean };
}) {
  const feePercent = platformFeeBps ? platformFeeBps / 100 : 0;
  const [integrations, setIntegrations] = useState(initialIntegrations);
  const [, startTransition] = useTransition();
  const { copied, copy } = useCopy();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // ── Phone ──
  const twilioIntegration = integrations.find((i) => i.provider === "twilio");
  const twilioConnected = twilioIntegration?.status === "connected";
  const phoneNumber = (twilioIntegration?.metadata as Record<string, unknown> | null)?.phone_number as string | undefined;
  const hasNumber = twilioConnected && Boolean(phoneNumber);
  const digits10 = phoneNumber ? phoneNumber.replace(/\D/g, "").slice(-10) : "";
  const [areaCode, setAreaCode] = useState("");
  const [changingNumber, setChangingNumber] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const areaCodeRef = useRef<HTMLInputElement>(null);
  const areaCodeValid = /^\d{3}$/.test(areaCode);

  function requestNumber() {
    if (!areaCodeValid) { setPhoneError("Enter a 3-digit area code first."); return; }
    setProvisioning(true);
    setPhoneError(null);
    startTransition(async () => {
      const result = hasNumber ? await changePhoneNumberAction(areaCode) : await provisionPhoneNumberAction(areaCode);
      setProvisioning(false);
      if (!result.success) { setPhoneError(result.error || "Could not get a number."); return; }
      setIntegrations((prev) => prev.map((i) => (i.provider === "twilio" ? { ...i, status: "connected", metadata: { phone_number: result.phoneNumber } } : i)));
      setChangingNumber(false);
      setAreaCode("");
    });
  }

  // ── Texting ──
  // Texts go out from the phone number above, so they can't work without
  // one. The "sms" row only exists once HavnLine marks carrier approval as
  // done (set it to "connected" for the business when the A2P campaign is
  // approved); until then texts may be filtered by the carriers.
  const textingApproved = integrations.find((i) => i.provider === "sms")?.status === "connected";
  const identityOnFile = Boolean(textingIdentity.legalBusinessName) && textingIdentity.hasEin;
  const [identity, setIdentity] = useState({ legalBusinessName: textingIdentity.legalBusinessName || "", ein: "" });
  const [identitySaved, setIdentitySaved] = useState(identityOnFile);
  const [savedName, setSavedName] = useState(textingIdentity.legalBusinessName);
  const [editingIdentity, setEditingIdentity] = useState(false);
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);

  function saveIdentity() {
    setSavingIdentity(true);
    setIdentityError(null);
    startTransition(async () => {
      const result = await saveTextingIdentityAction(identity);
      setSavingIdentity(false);
      if (!result.success) { setIdentityError(result.error || "Could not save."); return; }
      setIdentitySaved(true);
      setSavedName(identity.legalBusinessName.trim());
      setEditingIdentity(false);
      setIdentity((s) => ({ ...s, ein: "" }));
    });
  }

  // ── Stripe ──
  const [onboarding, setOnboarding] = useState(false);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const stripeStarted = Boolean(stripeConnectAccountId);

  function startStripe() {
    setOnboarding(true);
    setPaymentsError(null);
    startTransition(async () => {
      const result = await startStripeConnectOnboardingAction();
      if (!result.url) {
        setOnboarding(false);
        setPaymentsError(result.error || "Could not open Stripe.");
        return;
      }
      window.location.href = result.url;
    });
  }

  // ── Printer tablet ──
  const printerAppIntegration = integrations.find((i) => i.provider === "printer_app");
  const tabletPaired = printerAppIntegration?.status === "connected";
  const printerMeta = printerAppIntegration?.metadata as { printer_ip?: string | null; last_seen_at?: string | null } | null;
  const lastSeen = printerMeta?.last_seen_at || null;
  const tabletStale = !lastSeen || now - new Date(lastSeen).getTime() > TABLET_STALE_MS;
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [unpairing, setUnpairing] = useState(false);
  const [printerError, setPrinterError] = useState<string | null>(null);

  function generateCode() {
    setGeneratingCode(true);
    setPrinterError(null);
    startTransition(async () => {
      const result = await generatePrinterAppCodeAction();
      setGeneratingCode(false);
      if (!result.success) { setPrinterError(result.error || "Could not generate a code."); return; }
      setPairingCode(result.code || null);
      setPairingExpiresAt(result.expiresAt || null);
    });
  }

  function unpair() {
    setUnpairing(true);
    startTransition(async () => {
      await unpairPrinterAppAction();
      setUnpairing(false);
      setPairingCode(null);
      setIntegrations((prev) => prev.map((i) => (i.provider === "printer_app" ? { ...i, status: "not_connected", metadata: null, connected_at: null } : i)));
    });
  }

  // ── Forwarding ──
  const [carrier, setCarrier] = useState<Carrier>("verizon");
  const codes = forwardingCodes(carrier, digits10);

  function goTo(id: string, focus?: () => void) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (focus) setTimeout(focus, 400);
  }

  const steps = [
    {
      key: "phone",
      label: "Phone number",
      done: hasNumber,
      blocking: true,
      detail: hasNumber && phoneNumber ? `Your AI answers ${formatPhone(phoneNumber)}` : "Needed before your AI can answer calls",
      action: { label: "Get a number", onClick: () => goTo("phone", () => areaCodeRef.current?.focus()) },
    },
    {
      key: "payments",
      label: "Card payments",
      done: stripeConnectChargesEnabled,
      blocking: true,
      detail: stripeConnectChargesEnabled ? "Customers pay by card on every order" : "Needed before your AI can take orders",
      action: { label: stripeStarted ? "Finish Stripe setup" : "Connect Stripe", onClick: startStripe },
    },
    {
      key: "tablet",
      label: "Kitchen tablet",
      done: tabletPaired,
      blocking: false,
      detail: tabletPaired ? "Orders print in the kitchen" : "Optional: print orders in the kitchen",
      action: { label: "Pair a tablet", onClick: () => goTo("printer") },
    },
  ];
  const allDone = steps.every((s) => s.done);

  const codeBox = "rounded-lg border border-border bg-paper px-3 py-2 font-mono text-[14px] font-semibold text-ink";

  return (
    <div className="space-y-6">
      {/* Setup checklist */}
      <section className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-[15px] font-semibold text-ink">{allDone ? "You're all set" : "Setup"}</h2>
          <span className="text-[12px] text-text-faint">{steps.filter((s) => s.done).length} of {steps.length} done</span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {steps.map((s) => {
            const warn = !s.done && s.blocking;
            return (
              <div key={s.key} className={`flex flex-col rounded-xl border px-4 py-3 ${s.done ? "border-border bg-paper" : warn ? "border-amber-300 bg-amber-50" : "border-border bg-paper"}`}>
                <div className="flex items-center gap-2">
                  {s.done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" /> : warn ? <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" /> : <Circle className="h-4 w-4 shrink-0 text-text-faint" />}
                  <span className="text-[13px] font-semibold text-ink">{s.label}</span>
                </div>
                <p className={`mt-1 text-[12px] ${warn ? "text-amber-800" : "text-text-muted"}`}>{s.detail}</p>
                {!s.done && (
                  <button
                    type="button"
                    onClick={s.action.onClick}
                    disabled={s.key === "payments" && onboarding}
                    className={`mt-2 inline-flex w-fit items-center gap-1 text-[12.5px] font-semibold ${warn ? "text-amber-800 hover:text-amber-900" : "text-brand-dark hover:text-brand"}`}
                  >
                    {s.key === "payments" && onboarding ? "Opening Stripe…" : s.action.label} <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Kitchen & payments */}
      <div>
        <h3 className="mb-2.5 text-[12px] font-semibold uppercase tracking-wide text-text-faint">Kitchen &amp; payments</h3>
        <div className="grid gap-4 lg:grid-cols-2">
          <CardShell
            id="printer"
            icon={Tablet}
            title="Kitchen tablet"
            subtitle="HavnLine Printer App on an Android tablet"
            status={tabletPaired ? <StatusPill tone="success">Paired</StatusPill> : <StatusPill tone="neutral">Not paired</StatusPill>}
          >
            {tabletPaired ? (
              <>
                <div className="space-y-2 rounded-xl border border-border bg-paper px-4 py-3 text-[12.5px]">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-text-muted">Printer</span>
                    <span className="font-medium text-ink">{printerMeta?.printer_ip || "Not set yet (add it in the app)"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-text-muted">Last check-in</span>
                    <span suppressHydrationWarning className={`flex items-center gap-1.5 font-medium ${tabletStale ? "text-amber-700" : "text-success"}`}>
                      <span className={`h-2 w-2 rounded-full ${tabletStale ? "bg-amber-500" : "bg-success"}`} />
                      {lastSeen ? timeAgo(lastSeen, now) : "Never"}
                    </span>
                  </div>
                </div>
                {tabletStale && (
                  <p className="mt-2 text-[12px] text-amber-700">The tablet hasn&apos;t checked in recently. Make sure the app is open so new orders print.</p>
                )}
                <p className="mt-3 text-[12.5px] leading-relaxed text-text-muted">
                  Prints every new order. Staff can also look up today&apos;s orders, give a PIN-protected refund or discount, and add items right from the tablet.
                </p>
                <div className="mt-auto pt-4">
                  <Button size="sm" variant="outline" onClick={unpair} disabled={unpairing}>{unpairing ? "Unpairing…" : "Unpair tablet"}</Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-[12.5px] leading-relaxed text-text-muted">
                  Install the HavnLine app on any Android tablet to print orders in the kitchen and handle refunds, discounts, and added items from the floor.
                </p>
                {pairingCode && (
                  <div className="mt-3 rounded-xl border border-border bg-paper px-4 py-3">
                    <p className="text-[12px] text-text-muted">Enter this code in the app on your tablet:</p>
                    <div className="mt-1.5 font-mono text-[24px] font-semibold tracking-[0.2em] text-ink">{pairingCode}</div>
                    {pairingExpiresAt && <p className="mt-1 text-[11px] text-text-faint">Expires at {new Date(pairingExpiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>}
                  </div>
                )}
                {printerError && <p className="mt-2 text-[12.5px] text-danger">{printerError}</p>}
                <div className="mt-auto pt-4">
                  <Button size="sm" variant="brand" onClick={generateCode} disabled={generatingCode}>
                    {generatingCode ? "Generating…" : pairingCode ? "Get a new code" : "Get pairing code"}
                  </Button>
                </div>
              </>
            )}
          </CardShell>

          <CardShell
            id="payments"
            icon={CreditCard}
            title="Card payments"
            subtitle="Stripe Connect"
            status={
              stripeConnectChargesEnabled ? <StatusPill tone="success">Connected</StatusPill>
              : stripeStarted ? <StatusPill tone="warning">Setup unfinished</StatusPill>
              : <StatusPill tone="warning">Required</StatusPill>
            }
          >
            <p className="text-[12.5px] leading-relaxed text-text-muted">
              {stripeConnectChargesEnabled
                ? "After confirming an order, your AI texts the customer a payment link. The ticket prints once it's paid, and the money goes to your own bank account."
                : stripeStarted
                ? "Stripe still needs a few more details from you. Until it's finished, your AI can't take orders, because every phone order is paid up front."
                : "Every phone order is paid up front by card, so your AI can't take orders until Stripe is connected. Money goes straight to your own bank account."}
            </p>
            {feePercent > 0 && (
              <p className="mt-3 rounded-lg bg-paper px-3 py-2 text-[12px] text-text-muted">
                HavnLine keeps {feePercent}% of each phone payment, taken out automatically. A $50 order pays you ${(50 - 50 * (feePercent / 100)).toFixed(2)}.
              </p>
            )}
            {paymentsError && <p className="mt-2 text-[12.5px] text-danger">{paymentsError}</p>}
            <div className="mt-auto pt-4">
              <Button size="sm" variant={stripeConnectChargesEnabled ? "outline" : "brand"} onClick={startStripe} disabled={onboarding}>
                {onboarding ? "Opening Stripe…" : stripeConnectChargesEnabled ? "Manage on Stripe" : stripeStarted ? "Finish setup" : "Connect Stripe"}
              </Button>
            </div>
          </CardShell>
        </div>
      </div>

      {/* Phone & texting */}
      <div>
        <h3 className="mb-2.5 text-[12px] font-semibold uppercase tracking-wide text-text-faint">Phone &amp; texting</h3>
        <div className="grid gap-4 lg:grid-cols-2">
          <CardShell
            id="phone"
            icon={PhoneCall}
            title="Phone number"
            subtitle="The number your AI answers"
            status={hasNumber ? <StatusPill tone="success">Connected</StatusPill> : <StatusPill tone="warning">Required</StatusPill>}
          >
            {hasNumber && phoneNumber && (
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-display text-[24px] font-semibold tracking-tight text-ink">{formatPhone(phoneNumber)}</span>
                <button
                  type="button"
                  onClick={() => copy("number", phoneNumber)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-paper px-2.5 py-1 text-[12px] font-medium text-text-muted hover:text-ink"
                >
                  {copied === "number" ? <><Check className="h-3.5 w-3.5 text-success" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
                </button>
              </div>
            )}
            <p className="mt-2 text-[12.5px] text-text-muted">
              {hasNumber ? "Every call to this number is answered by your AI." : "Pick an area code and we'll get you a local number for your AI to answer."}
            </p>

            {(!hasNumber || changingNumber) && (
              <div className="mt-4 rounded-xl border border-border bg-paper px-4 py-3">
                {changingNumber && (
                  <p className="mb-3 text-[12px] text-amber-700">Your current number stops working right away. Update your call forwarding afterwards.</p>
                )}
                <label htmlFor="area-code-input" className="text-[12px] font-medium text-text-muted">Area code</label>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <Input
                    id="area-code-input"
                    ref={areaCodeRef}
                    inputMode="numeric"
                    placeholder="e.g. 313"
                    value={areaCode}
                    onChange={(e) => { setAreaCode(e.target.value.replace(/\D/g, "").slice(0, 3)); setPhoneError(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter" && areaCodeValid) requestNumber(); }}
                    className="w-24"
                  />
                  <Button size="sm" variant="brand" onClick={requestNumber} disabled={provisioning || !areaCodeValid}>
                    {provisioning ? "Getting number…" : hasNumber ? "Get new number" : "Get a number"}
                  </Button>
                  {changingNumber && (
                    <Button size="sm" variant="ghost" onClick={() => { setChangingNumber(false); setAreaCode(""); setPhoneError(null); }} disabled={provisioning}>Cancel</Button>
                  )}
                </div>
              </div>
            )}
            {phoneError && <p className="mt-2 text-[12.5px] text-danger">{phoneError}</p>}

            {hasNumber && !changingNumber && (
              <div className="pt-3">
                <button
                  type="button"
                  onClick={() => { setChangingNumber(true); setTimeout(() => areaCodeRef.current?.focus(), 0); }}
                  className="text-[12.5px] font-medium text-text-muted underline-offset-2 hover:text-ink hover:underline"
                >
                  Change number
                </button>
              </div>
            )}
          </CardShell>

          <CardShell
            id="texting"
            icon={MessageSquare}
            title="Text messages"
            subtitle="Order confirmations and payment links"
            status={
              !hasNumber ? <StatusPill tone="neutral">Not set up</StatusPill>
              : textingApproved ? <StatusPill tone="success">Active</StatusPill>
              : <StatusPill tone="warning">Awaiting approval</StatusPill>
            }
          >
            {!hasNumber || !phoneNumber ? (
              <p className="text-[12.5px] leading-relaxed text-text-muted">Texts are sent from your HavnLine number. Get a number first and texting is set up with it.</p>
            ) : (
              <>
                <p className="text-[12.5px] leading-relaxed text-text-muted">
                  Sent automatically from <span className="font-medium text-ink">{formatPhone(phoneNumber)}</span> after each order.
                </p>
                {textingApproved ? (
                  <p className="mt-3 flex items-center gap-1.5 text-[12.5px] font-medium text-success"><CheckCircle2 className="h-4 w-4" /> Approved by US carriers</p>
                ) : (
                  <>
                    <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-800">
                      US carriers have to approve business texting first. Until then, payment links may not reach customers. Approval needs your legal business name and EIN, exactly as the IRS has them.
                    </p>
                    {identitySaved && !editingIdentity ? (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-paper px-4 py-3">
                        <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-ink">
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                          <span className="truncate">{savedName} · EIN on file</span>
                        </span>
                        <button type="button" onClick={() => setEditingIdentity(true)} className="text-[12.5px] font-medium text-brand-dark hover:text-brand">Edit</button>
                      </div>
                    ) : (
                      <div className="mt-3 space-y-2.5 rounded-xl border border-border bg-paper px-4 py-3">
                        <div>
                          <label htmlFor="legal-name" className="text-[12px] font-medium text-text-muted">Legal business name</label>
                          <Input id="legal-name" className="mt-1" placeholder="e.g. Main Street Grill LLC" value={identity.legalBusinessName} onChange={(e) => setIdentity((s) => ({ ...s, legalBusinessName: e.target.value }))} />
                        </div>
                        <div>
                          <label htmlFor="ein" className="text-[12px] font-medium text-text-muted">EIN</label>
                          <Input id="ein" className="mt-1 w-40" inputMode="numeric" autoComplete="off" maxLength={10} placeholder="12-3456789" value={identity.ein} onChange={(e) => setIdentity((s) => ({ ...s, ein: e.target.value }))} />
                        </div>
                        {identityError && <p className="text-[12px] text-danger">{identityError}</p>}
                        <div className="flex gap-2">
                          <Button size="sm" variant="brand" onClick={saveIdentity} disabled={savingIdentity}>{savingIdentity ? "Saving…" : "Save"}</Button>
                          {editingIdentity && <Button size="sm" variant="ghost" onClick={() => { setEditingIdentity(false); setIdentityError(null); }}>Cancel</Button>}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </CardShell>

          {hasNumber && phoneNumber && (
            <CardShell
              id="forwarding"
              icon={PhoneForwarded}
              title="Keep your current business number"
              subtitle="Forward the number customers already know to your HavnLine number"
              status={null}
              className="lg:col-span-2"
            >
              <div role="tablist" aria-label="Your phone carrier" className="flex flex-wrap gap-2">
                {CARRIERS.map((c) => (
                  <button
                    key={c.id}
                    role="tab"
                    aria-selected={carrier === c.id}
                    onClick={() => setCarrier(c.id)}
                    className={`rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors ${carrier === c.id ? "border-brand bg-brand-soft text-brand-dark" : "border-border bg-card text-text-muted hover:text-ink"}`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>

              {codes ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-border bg-card px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">Turn forwarding on</div>
                    <p className="mt-1 text-[12px] text-text-muted">From the phone you want to forward, dial this and press call:</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className={codeBox}>{codes.on}</span>
                      <button type="button" onClick={() => copy("on", codes.on)} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-medium text-text-muted hover:text-ink">
                        {copied === "on" ? <><Check className="h-3.5 w-3.5 text-success" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
                      </button>
                      <a href={`tel:${encodeURIComponent(codes.on)}`} className="inline-flex items-center gap-1 rounded-lg bg-brand px-2.5 py-1.5 text-[12px] font-semibold text-white sm:hidden">
                        <PhoneCall className="h-3.5 w-3.5" /> Dial
                      </a>
                    </div>
                  </div>
                  <div className="rounded-xl border border-border bg-card px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">Turn it off later</div>
                    <p className="mt-1 text-[12px] text-text-muted">Dial this from the same phone:</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className={codeBox}>{codes.off}</span>
                      <button type="button" onClick={() => copy("off", codes.off)} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-medium text-text-muted hover:text-ink">
                        {copied === "off" ? <><Check className="h-3.5 w-3.5 text-success" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="mt-4 rounded-xl border border-border bg-card px-4 py-3 text-[12.5px] leading-relaxed text-text-muted">
                  Look for <span className="font-medium text-ink">call forwarding</span> (sometimes &ldquo;always forward&rdquo;) in your phone provider&apos;s app, website, or phone system settings, and forward all calls to <span className="font-medium text-ink">{formatPhone(phoneNumber)}</span>. Your provider&apos;s support line can turn it on for you too.
                </p>
              )}
              <p className="mt-3 text-[12px] text-text-faint">Then call your old number from another phone. Your AI should pick up.</p>
            </CardShell>
          )}
        </div>
      </div>
    </div>
  );
}
