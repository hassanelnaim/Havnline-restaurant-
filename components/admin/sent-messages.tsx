"use client";
import { useState } from "react";
import type { SentMessageRow } from "@/lib/admin/messages";

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const EMAIL_LABEL: Record<string, string> = { sent: "Emailed", failed: "Email failed", no_email: "No email on file", pending: "Sending" };

export function SentMessages({ messages }: { messages: SentMessageRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <h2 className="text-[13px] font-semibold text-ink">Sent</h2>
      {messages.length === 0 ? (
        <p className="mt-2 text-[13px] text-text-muted">Nothing sent yet. Messages you send show here with who read them.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {messages.map((m) => (
            <li key={m.id} className="py-3">
              <button type="button" className="w-full text-left" aria-expanded={open === m.id} onClick={() => setOpen(open === m.id ? null : m.id)}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[13.5px] font-medium text-ink">{m.subject}</span>
                  <span className="shrink-0 text-[11.5px] text-text-faint">{when(m.createdAt)}</span>
                </div>
                <div className="mt-0.5 text-[12px] text-text-muted">
                  {m.audience} · {m.restaurants} sent · {m.read} read
                  {m.failed > 0 && <span className="text-danger"> · {m.failed} email failed</span>}
                  {m.noEmail > 0 && <span> · {m.noEmail} no email</span>}
                </div>
              </button>
              {open === m.id && (
                <div className="mt-3">
                  <p className="whitespace-pre-wrap rounded-lg bg-paper px-3 py-2.5 text-[12.5px] text-ink">{m.body}</p>
                  <ul className="mt-2 max-h-56 overflow-y-auto text-[12.5px]">
                    {m.recipients.map((r) => (
                      <li key={r.businessId} className="flex items-center justify-between gap-3 border-b border-border py-1.5 last:border-0">
                        <span className="min-w-0 truncate text-ink">{r.name}</span>
                        <span className={`shrink-0 ${r.emailStatus === "failed" ? "text-danger" : "text-text-muted"}`} title={r.emailError || undefined}>
                          {EMAIL_LABEL[r.emailStatus] || r.emailStatus} · {r.readAt ? `read ${when(r.readAt)}` : "not read"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
