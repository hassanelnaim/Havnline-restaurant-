"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, FlaskConical, Search } from "lucide-react";
import { countMessageAudienceAction, sendPlatformMessageAction, sendTestMessageAction } from "@/app/actions/platform-messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { MessageAudience } from "@/lib/admin/messages";

export interface ComposerRestaurant {
  id: string;
  name: string;
  status: string;
  isSuspended: boolean;
}

interface Props {
  restaurants: ComposerRestaurant[];
  statuses: { value: string; label: string }[];
  subjectMax: number;
  bodyMax: number;
  /** Restaurant ids to start with picked, from ?to= on the URL. */
  initialSelected: string[];
}

type Mode = "all" | "status" | "selected";

function newSendKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function MessageComposer({ restaurants, statuses, subjectMax, bodyMax, initialSelected }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>(initialSelected.length ? "selected" : "all");
  const [picked, setPicked] = useState<string[]>(["active", "trialing"]);
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<null | "test" | "count" | "send">(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [confirmCount, setConfirmCount] = useState<number | null>(null);
  // One key per message: a double click, or a retry after a slow answer, can't send twice.
  const [sendKey, setSendKey] = useState(newSendKey);

  const audience: MessageAudience = mode === "all" ? { kind: "all" } : mode === "status" ? { kind: "status", statuses: picked } : { kind: "selected", businessIds: selected };

  const estimate = useMemo(() => {
    if (mode === "all") return restaurants.length;
    if (mode === "selected") return selected.length;
    const want = new Set(picked);
    return restaurants.filter((r) => (want.has("suspended") && r.isSuspended) || want.has(r.status || "none")).length;
  }, [mode, picked, selected, restaurants]);

  const shown = restaurants.filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase()));
  const textReady = subject.trim().length > 0 && body.trim().length > 0 && subject.length <= subjectMax && body.length <= bodyMax;

  function sendTest() {
    setBusy("test");
    setNotice(null);
    startTransition(async () => {
      const r = await sendTestMessageAction(subject, body);
      setBusy(null);
      setNotice(r.success ? { kind: "ok", text: "Test sent to your email. Check how it looks before sending to restaurants." } : { kind: "error", text: r.error || "The test didn't send." });
    });
  }

  function openConfirm() {
    setBusy("count");
    setNotice(null);
    startTransition(async () => {
      const r = await countMessageAudienceAction(audience);
      setBusy(null);
      if (!r.success) return setNotice({ kind: "error", text: r.error || "Couldn't count the restaurants." });
      if (!r.count) return setNotice({ kind: "error", text: "No restaurants match, so there's no one to send to." });
      setConfirmCount(r.count);
    });
  }

  function send() {
    if (confirmCount === null) return;
    setBusy("send");
    startTransition(async () => {
      const r = await sendPlatformMessageAction({ sendKey, subject, body, audience, expectedCount: confirmCount });
      setBusy(null);
      if (!r.success) {
        if (typeof r.count === "number") setConfirmCount(r.count);
        setNotice({ kind: "error", text: r.error || "The message didn't send." });
        if (typeof r.count !== "number") setConfirmCount(null);
        return;
      }
      const s = r.summary!;
      setConfirmCount(null);
      const parts = [`Sent to ${s.restaurants} ${s.restaurants === 1 ? "restaurant" : "restaurants"}.`];
      if (s.alreadySent) parts.splice(0, 1, "This message was already sent; it wasn't sent again.");
      if (s.failed) parts.push(`${s.failed} emails failed; they'll still see it on their dashboard.`);
      if (s.noEmail) parts.push(`${s.noEmail} had no email on file; they'll see it on their dashboard.`);
      setNotice({ kind: s.failed ? "error" : "ok", text: parts.join(" ") });
      setSubject("");
      setBody("");
      setSendKey(newSendKey());
      router.refresh();
    });
  }

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <fieldset>
        <legend className="text-[13px] font-semibold text-ink">Who gets it</legend>
        <div className="mt-2 flex flex-wrap gap-2" role="radiogroup">
          {([["all", "All restaurants"], ["status", "By status"], ["selected", "Pick restaurants"]] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => setMode(value)}
              className={`rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium ${mode === value ? "border-brand bg-brand-soft text-brand" : "border-border text-text-muted hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "status" && (
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
            {statuses.map((s) => (
              <label key={s.value} className="flex items-center gap-2 text-[13px] text-ink">
                <input type="checkbox" id={`status-${s.value}`} checked={picked.includes(s.value)} onChange={() => setPicked((p) => toggle(p, s.value))} />
                {s.label}
              </label>
            ))}
          </div>
        )}

        {mode === "selected" && (
          <div className="mt-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
              <Input id="restaurant-search" className="pl-8" placeholder="Search restaurants" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border">
              {shown.length === 0 ? (
                <div className="px-3 py-2.5 text-[12.5px] text-text-muted">No restaurants match.</div>
              ) : (
                shown.map((r) => (
                  <label key={r.id} className="flex items-center gap-2.5 border-b border-border px-3 py-2 text-[13px] text-ink last:border-0">
                    <input type="checkbox" checked={selected.includes(r.id)} onChange={() => setSelected((s) => toggle(s, r.id))} />
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    <span className="text-[11.5px] text-text-faint">{r.isSuspended ? "suspended" : r.status || "none"}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        )}
        <p className="mt-2 text-[12.5px] text-text-muted">{estimate === 1 ? "1 restaurant" : `${estimate} restaurants`} will get this.</p>
      </fieldset>

      <div className="mt-5">
        <Label htmlFor="message-subject">Subject</Label>
        <Input id="message-subject" className="mt-1.5" maxLength={subjectMax} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. New: refunds from the kitchen tablet" />
      </div>
      <div className="mt-4">
        <Label htmlFor="message-body">Message</Label>
        <Textarea id="message-body" rows={8} className="mt-1.5" maxLength={bodyMax} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write it as you'd say it. A blank line starts a new paragraph." />
        <div className="mt-1 text-right text-[11.5px] text-text-faint">
          {body.length.toLocaleString()} / {bodyMax.toLocaleString()}
        </div>
      </div>
      <p className="text-[12px] text-text-faint">
        For service updates only: new features, outages, changes to how HavnLine works. It's emailed to everyone on each restaurant's account, replies go to your support inbox, and it shows on their dashboard until they mark it read.
      </p>

      {notice && (
        <div role="status" className={`mt-4 rounded-lg border px-3.5 py-2.5 text-[12.5px] ${notice.kind === "ok" ? "border-success/20 bg-success-soft text-success" : "border-danger/20 bg-danger-soft text-danger"}`}>
          {notice.text}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="brand" onClick={openConfirm} disabled={!textReady || estimate === 0 || busy !== null}>
          <Send className="h-3.5 w-3.5" /> {busy === "count" ? "Checking…" : "Send…"}
        </Button>
        <Button variant="outline" onClick={sendTest} disabled={!textReady || busy !== null}>
          <FlaskConical className="h-3.5 w-3.5" /> {busy === "test" ? "Sending test…" : "Send a test to me"}
        </Button>
      </div>

      <Dialog open={confirmCount !== null} onOpenChange={(open) => !open && busy !== "send" && setConfirmCount(null)}>
        <DialogContent>
          <DialogTitle className="font-display text-[17px] font-semibold text-ink">
            Send to {confirmCount} {confirmCount === 1 ? "restaurant" : "restaurants"}?
          </DialogTitle>
          <DialogDescription className="mt-2 text-[13px] text-text-muted">
            “{subject.trim()}” will be emailed to everyone on {confirmCount === 1 ? "that restaurant's account" : "their accounts"} now. Emails can't be taken back.
          </DialogDescription>
          {notice?.kind === "error" && <div className="mt-3 rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{notice.text}</div>}
          <div className="mt-5 flex gap-2">
            <Button variant="brand" onClick={send} disabled={busy === "send"}>{busy === "send" ? "Sending…" : "Yes, send it"}</Button>
            <Button variant="outline" onClick={() => setConfirmCount(null)} disabled={busy === "send"}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
