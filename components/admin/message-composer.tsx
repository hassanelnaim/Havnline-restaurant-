"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, FlaskConical } from "lucide-react";
import { countMessageAudienceAction, sendPlatformMessageAction, sendTestMessageAction } from "@/app/actions/platform-messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AudiencePicker, estimateAudience, toAudience, type AudienceState, type ComposerRestaurant } from "@/components/admin/audience-picker";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export type { ComposerRestaurant };

interface Props {
  restaurants: ComposerRestaurant[];
  statuses: { value: string; label: string }[];
  subjectMax: number;
  bodyMax: number;
  /** Restaurant ids to start with picked, from ?to= on the URL. */
  initialSelected: string[];
}

function newSendKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function MessageComposer({ restaurants, statuses, subjectMax, bodyMax, initialSelected }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [aud, setAud] = useState<AudienceState>({ mode: initialSelected.length ? "selected" : "all", picked: ["active", "trialing"], selected: initialSelected });
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<null | "test" | "count" | "send">(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [confirmCount, setConfirmCount] = useState<number | null>(null);
  // One key per message: a double click, or a retry after a slow answer, can't send twice.
  const [sendKey, setSendKey] = useState(newSendKey);

  const audience = toAudience(aud);
  const estimate = estimateAudience(aud, restaurants);

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

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <AudiencePicker legend="Who gets it" verb="will get this" restaurants={restaurants} statuses={statuses} value={aud} onChange={setAud} />

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
