"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, MessageSquare } from "lucide-react";
import { setTextingApprovedAction } from "@/app/actions/platform-admin";

export interface TextingRegistrationInfo {
  legalBusinessName: string | null;
  /** "sole_proprietor" registers as a Sole Proprietor brand (owner's name, no EIN, OTP to a mobile). Null: asked before migration 043. */
  entityType: "business" | "sole_proprietor" | null;
  /** Nine digits, no dash. Shown only on this admin page, for registration. */
  ein: string | null;
  address: string | null;
  website: string | null;
  contactPhone: string | null;
  havnlineNumber: string | null;
  subaccountSid: string | null;
  approved: boolean;
}

function Row({ label, value, copyValue, optional }: { label: string; value: string | null; copyValue?: string | null; optional?: boolean }) {
  const [copied, setCopied] = useState(false);
  const toCopy = copyValue ?? value;
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-[12.5px] text-text-muted">{label}</span>
      <span className="flex min-w-0 items-center gap-2">
        <span className={`truncate text-[13px] ${value ? "font-medium text-ink" : optional ? "text-text-faint" : "text-amber-700"}`}>{value || (optional ? "None" : "Missing")}</span>
        {value && toCopy && (
          <button
            type="button"
            aria-label={`Copy ${label}`}
            onClick={() => { navigator.clipboard.writeText(toCopy).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
            className="shrink-0 text-text-faint hover:text-ink"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        )}
      </span>
    </div>
  );
}

export function TextingRegistration({ businessId, info }: { businessId: string; info: TextingRegistrationInfo }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ein = info.ein ? `${info.ein.slice(0, 2)}-${info.ein.slice(2)}` : null;
  const sole = info.entityType === "sole_proprietor" && !info.ein;
  const ready = Boolean(info.legalBusinessName && (info.ein || sole) && info.havnlineNumber);

  function toggle() {
    setError(null);
    startTransition(async () => {
      const result = await setTextingApprovedAction(businessId, !info.approved);
      if (!result.success) { setError(result.error || "Could not update."); return; }
      router.refresh();
    });
  }

  return (
    <div className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-brand" />
          <h2 className="font-display text-[15px] font-semibold text-ink">Texting registration (A2P 10DLC)</h2>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${info.approved ? "bg-success-soft text-success" : ready ? "bg-brand-soft text-brand-dark" : "bg-amber-50 text-amber-700"}`}>
          {info.approved ? "Approved" : ready ? "Ready to register" : "Waiting on details"}
        </span>
      </div>
      <p className="mt-1 text-[12px] text-text-faint">
        Register this business&apos;s brand and campaign in Twilio, under its sub-account, with the details below. A Sole Proprietor brand needs the owner&apos;s mobile number for Twilio&apos;s one-time code: contact the owner for it. Once Twilio approves the campaign, mark it approved so the restaurant&apos;s Integrations page shows texting as active.
      </p>

      <div className="mt-3 divide-y divide-border-soft">
        <Row label="Registration type" value={sole ? "Sole Proprietor brand (no EIN)" : "Standard brand (EIN)"} />
        <Row label={sole ? "Owner's legal name" : "Legal business name"} value={info.legalBusinessName} />
        {!sole && <Row label="EIN" value={ein} copyValue={info.ein} />}
        <Row label="Address" value={info.address} />
        <Row label="Website" value={info.website} optional />
        <Row label="Contact phone" value={info.contactPhone} />
        <Row label="HavnLine number" value={info.havnlineNumber} />
        <Row label="Twilio sub-account" value={info.subaccountSid} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border-soft pt-4">
        <button
          onClick={toggle}
          disabled={isPending || (!info.approved && !ready)}
          className={`h-9 rounded-lg px-3 text-[12.5px] font-medium disabled:opacity-40 ${info.approved ? "border border-border text-text" : "bg-ink text-white"}`}
        >
          {isPending ? "Saving…" : info.approved ? "Mark as not approved" : "Mark texting approved"}
        </button>
        {!info.approved && !ready && <span className="text-[12px] text-text-faint">Needs the legal name, EIN (or sole proprietor), and a HavnLine number first.</span>}
        {error && <span className="text-[12px] text-danger">{error}</span>}
      </div>
    </div>
  );
}
