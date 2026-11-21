"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PauseCircle } from "lucide-react";
import { countMessageAudienceAction } from "@/app/actions/platform-messages";
import { createPauseAction } from "@/app/actions/ai-pause";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AudiencePicker, estimateAudience, toAudience, type AudienceState, type ComposerRestaurant } from "@/components/admin/audience-picker";

interface Props {
  restaurants: ComposerRestaurant[];
  statuses: { value: string; label: string }[];
  subjectMax: number;
  bodyMax: number;
  initialSelected: string[];
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/** "Sat, Nov 22, 2:00 AM EST" in the admin's own time zone. */
function fmt(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(d);
}

/** Tomorrow at 2 AM local, as a datetime-local value. */
function defaultStart(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(2, 0, 0, 0);
  return toLocalInput(d);
}
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function draftMessage(start: Date | null, end: Date | null): { subject: string; body: string } {
  const when = start ? fmt(start) : "now";
  const subject = start
    ? `Your AI order-taker will pause for an update on ${new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(start)}`
    : "Your AI order-taker is paused for an update";
  const window = start
    ? end
      ? `from ${when} until ${fmt(end)}`
      : `starting ${when}, until we finish (we'll let you know)`
    : end
      ? `from now until ${fmt(end)}`
      : "from now until we finish (we'll let you know)";
  const body =
    `We're updating HavnLine's AI order-taker to make it better. To keep things smooth, your AI won't answer calls ${window}.\n\n` +
    `During that time, calls to your HavnLine number will ring your restaurant's phone instead, so you won't miss orders. Please make sure someone can pick up.\n\n` +
    `Everything else works as normal: your dashboard, orders, and the kitchen tablet. Your AI turns back on by itself when we're done; you don't need to do anything.\n\n` +
    `Questions? Just reply to this email.`;
  return { subject, body };
}

export function PauseComposer({ restaurants, statuses, subjectMax, bodyMax, initialSelected }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [aud, setAud] = useState<AudienceState>({ mode: initialSelected.length ? "selected" : "all", picked: ["active", "trialing"], selected: initialSelected });
  const [startMode, setStartMode] = useState<"now" | "at">("at");
  const [startAt, setStartAt] = useState(defaultStart);
  const [endMode, setEndMode] = useState<"manual" | "at">("at");
  const [endAt, setEndAt] = useState(() => {
    const d = new Date(defaultStart());
    d.setHours(d.getHours() + 2);
    return toLocalInput(d);
  });
  const [reason, setReason] = useState("");
  const [withMessage, setWithMessage] = useState(true);
  const [edited, setEdited] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<null | "count" | "pause">(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [confirmCount, setConfirmCount] = useState<number | null>(null);
  const [createKey, setCreateKey] = useState(newKey);

  const start = startMode === "now" ? null : startAt ? new Date(startAt) : null;
  const end = endMode === "manual" ? null : endAt ? new Date(endAt) : null;
  const estimate = estimateAudience(aud, restaurants);
  // Until the admin edits it, the message follows the chosen times.
  const draft = draftMessage(start, end);
  const msgSubject = edited ? subject : draft.subject;
  const msgBody = edited ? body : draft.body;

  let timeError: string | null = null;
  if (startMode === "at" && (!start || Number.isNaN(start.getTime()))) timeError = "Pick a start time.";
  else if (startMode === "at" && start && start.getTime() < Date.now() - 60_000) timeError = "The start time is in the past.";
  else if (endMode === "at" && (!end || Number.isNaN(end.getTime()))) timeError = "Pick an end time.";
  else if (end && end.getTime() <= (start ? start.getTime() : Date.now())) timeError = "The end has to be after the start.";
  const messageReady = !withMessage || (msgSubject.trim() && msgBody.trim() && msgSubject.length <= subjectMax && msgBody.length <= bodyMax);

  function openConfirm() {
    setBusy("count");
    setNotice(null);
    startTransition(async () => {
      const r = await countMessageAudienceAction(toAudience(aud));
      setBusy(null);
      if (!r.success) return setNotice({ kind: "error", text: r.error || "Couldn't count the restaurants." });
      if (!r.count) return setNotice({ kind: "error", text: "No restaurants match, so there's nothing to pause." });
      setConfirmCount(r.count);
    });
  }

  function pause() {
    if (confirmCount === null) return;
    setBusy("pause");
    startTransition(async () => {
      const r = await createPauseAction({
        createKey,
        audience: toAudience(aud),
        expectedCount: confirmCount,
        startsAt: start ? start.toISOString() : null,
        endsAt: end ? end.toISOString() : null,
        reason,
        message: withMessage ? { subject: msgSubject, body: msgBody } : null,
      });
      setBusy(null);
      if (!r.success) {
        if (typeof r.count === "number") setConfirmCount(r.count);
        else setConfirmCount(null);
        setNotice({ kind: "error", text: r.error || "Nothing was paused." });
        return;
      }
      setConfirmCount(null);
      const n = r.restaurants || 0;
      const parts = [r.alreadyCreated ? "This pause was already saved; nothing was added twice." : `${start ? "Scheduled a pause" : "Paused the AI"} for ${n} ${n === 1 ? "restaurant" : "restaurants"}.`];
      if (r.message) {
        parts.push(`Message sent${r.message.failed ? `, but ${r.message.failed} emails failed (they'll still see it on their dashboard)` : ""}.`);
      }
      if (r.messageError) parts.push(`The message didn't send: ${r.messageError} Send it from Messages.`);
      setNotice({ kind: r.messageError || r.message?.failed ? "error" : "ok", text: parts.join(" ") });
      setCreateKey(newKey());
      setEdited(false);
      setReason("");
      router.refresh();
    });
  }

  const radio = (on: boolean) => `rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium ${on ? "border-brand bg-brand-soft text-brand" : "border-border text-text-muted hover:text-ink"}`;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <AudiencePicker legend="Which restaurants" verb="will be paused" restaurants={restaurants} statuses={statuses} value={aud} onChange={setAud} />

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <fieldset>
          <legend className="text-[13px] font-semibold text-ink">Starts</legend>
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Starts">
            <button type="button" role="radio" aria-checked={startMode === "now"} onClick={() => setStartMode("now")} className={radio(startMode === "now")}>Now</button>
            <button type="button" role="radio" aria-checked={startMode === "at"} onClick={() => setStartMode("at")} className={radio(startMode === "at")}>At a set time</button>
          </div>
          {startMode === "at" && <Input id="pause-start" type="datetime-local" className="mt-2" value={startAt} onChange={(e) => setStartAt(e.target.value)} aria-label="Start time" />}
        </fieldset>
        <fieldset>
          <legend className="text-[13px] font-semibold text-ink">Ends</legend>
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Ends">
            <button type="button" role="radio" aria-checked={endMode === "at"} onClick={() => setEndMode("at")} className={radio(endMode === "at")}>At a set time</button>
            <button type="button" role="radio" aria-checked={endMode === "manual"} onClick={() => setEndMode("manual")} className={radio(endMode === "manual")}>Resume by hand</button>
          </div>
          {endMode === "at" && <Input id="pause-end" type="datetime-local" className="mt-2" value={endAt} onChange={(e) => setEndAt(e.target.value)} aria-label="End time" />}
        </fieldset>
      </div>
      <p className="mt-2 text-[12px] text-text-faint">Times are in your time zone. While paused, calls ring each restaurant's own phone (its escalation number if it set one).</p>
      {timeError && <p className="mt-1 text-[12.5px] text-danger">{timeError}</p>}

      <div className="mt-4">
        <Label htmlFor="pause-reason">Note for the admin list (optional)</Label>
        <Input id="pause-reason" className="mt-1.5" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. New menu matching release" />
      </div>

      <label className="mt-5 flex items-center gap-2 text-[13px] font-medium text-ink">
        <input type="checkbox" id="pause-send-message" checked={withMessage} onChange={(e) => setWithMessage(e.target.checked)} />
        Also send a message about it now
      </label>
      {withMessage && (
        <div className="mt-3 rounded-xl border border-border p-4">
          <Label htmlFor="pause-subject">Subject</Label>
          <Input id="pause-subject" className="mt-1.5" maxLength={subjectMax} value={msgSubject} onChange={(e) => { setEdited(true); setSubject(e.target.value); setBody(msgBody); }} />
          <Label htmlFor="pause-body" className="mt-3 block">Message</Label>
          <Textarea id="pause-body" rows={8} className="mt-1.5" maxLength={bodyMax} value={msgBody} onChange={(e) => { setEdited(true); setBody(e.target.value); setSubject(msgSubject); }} />
          <div className="mt-1 flex justify-between text-[11.5px] text-text-faint">
            <span>{edited ? <button type="button" className="text-brand hover:underline" onClick={() => setEdited(false)}>Reset to match the times</button> : "Filled in from the times above. Edit it if you like."}</span>
            <span>{msgBody.length.toLocaleString()} / {bodyMax.toLocaleString()}</span>
          </div>
        </div>
      )}

      {notice && (
        <div role="status" className={`mt-4 rounded-lg border px-3.5 py-2.5 text-[12.5px] ${notice.kind === "ok" ? "border-success/20 bg-success-soft text-success" : "border-danger/20 bg-danger-soft text-danger"}`}>
          {notice.text}
        </div>
      )}

      <div className="mt-4">
        <Button variant="brand" onClick={openConfirm} disabled={Boolean(timeError) || !messageReady || estimate === 0 || busy !== null}>
          <PauseCircle className="h-3.5 w-3.5" /> {busy === "count" ? "Checking…" : "Pause…"}
        </Button>
      </div>

      <Dialog open={confirmCount !== null} onOpenChange={(open) => !open && busy !== "pause" && setConfirmCount(null)}>
        <DialogContent>
          <DialogTitle className="font-display text-[17px] font-semibold text-ink">
            Pause the AI for {confirmCount} {confirmCount === 1 ? "restaurant" : "restaurants"}?
          </DialogTitle>
          <DialogDescription className="mt-2 text-[13px] text-text-muted">
            {start ? `From ${fmt(start)}` : "Starting now"}
            {end ? ` until ${fmt(end)}` : " until you resume it"}. Calls will ring each restaurant's own phone.
            {withMessage ? " The message is emailed now and can't be taken back." : " No message will be sent."}
          </DialogDescription>
          {notice?.kind === "error" && <div className="mt-3 rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{notice.text}</div>}
          <div className="mt-5 flex gap-2">
            <Button variant="brand" onClick={pause} disabled={busy === "pause"}>{busy === "pause" ? "Pausing…" : "Yes, pause"}</Button>
            <Button variant="outline" onClick={() => setConfirmCount(null)} disabled={busy === "pause"}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
