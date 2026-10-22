"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, Printer, Volume2, RotateCcw, Check, MessageSquareText } from "lucide-react";

/**
 * A real test call to HavnLine (recorded on the caller's phone).
 *
 * While it plays: one subtitle line at a time under the player, and the
 * kitchen ticket fills in as the order is taken (the item, the change, the
 * total, the payment link). Before playing, the finished ticket shows what
 * the call produced.
 *
 * Times are seconds into the recording, taken from a transcript of the
 * audio and the pauses between phrases.
 */
export const DEMO_AUDIO_SRC = "/demo-call.mp3";

type Speaker = "ai" | "caller";
const CAPTIONS: { at: number; from: Speaker; text: string }[] = [
  { at: 0, from: "ai", text: "Hi, thanks for calling Durresi Coney Island!" },
  { at: 2.3, from: "ai", text: "You're talking to our AI order line." },
  { at: 4.5, from: "ai", text: "I can take your order or answer questions, and you can ask for a person anytime." },
  { at: 9.1, from: "ai", text: "What can I get started for you?" },
  { at: 10.8, from: "caller", text: "I'd like to order a cheeseburger." },
  { at: 14.7, from: "ai", text: "Great." },
  { at: 15.5, from: "ai", text: "For the cheeseburger, anything you'd like on it, or any way you'd like it prepared?" },
  { at: 19.9, from: "caller", text: "What comes on the cheeseburger?" },
  { at: 22.3, from: "ai", text: "It comes with lettuce, tomato, mayo, onions and pickles." },
  { at: 26.8, from: "ai", text: "Want it that way, or should I leave anything off?" },
  { at: 29.9, from: "caller", text: "No tomatoes." },
  { at: 32.4, from: "ai", text: "Got it, no tomatoes on that one." },
  { at: 34.7, from: "ai", text: "Anything else I can get for you?" },
  { at: 36.0, from: "caller", text: "No, thanks." },
  { at: 38.0, from: "ai", text: "Perfect." },
  { at: 39.1, from: "ai", text: "So that's one cheeseburger with no tomatoes, which comes to $14.99 before tax." },
  { at: 44.6, from: "ai", text: "Does that sound right?" },
  { at: 45.7, from: "caller", text: "Yes." },
  { at: 47.2, from: "ai", text: "Great!" },
  { at: 48.1, from: "ai", text: "Can I get your name and the best number to text your payment link to?" },
  { at: 51.6, from: "ai", text: "Your order goes to the kitchen as soon as it's paid." },
];

/** When each part of the ticket appears during playback. */
const TICKET = {
  item: 14.7, // the AI confirms the cheeseburger
  change: 32.4, // "Got it, no tomatoes"
  total: 41.5, // "...comes to $14.99"
  confirmed: 46.0, // caller says yes
  linkSent: 51.6, // "your order goes to the kitchen as soon as it's paid"
};

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function DemoCall() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [hasAudio, setHasAudio] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(54);

  useEffect(() => {
    fetch(DEMO_AUDIO_SRC, { method: "HEAD" })
      .then((r) => setHasAudio(r.ok && (r.headers.get("content-type") || "").startsWith("audio")))
      .catch(() => {});
  }, []);

  const currentIdx = started ? CAPTIONS.reduce((idx, c, i) => (c.at <= time + 0.05 ? i : idx), -1) : -1;
  const current = currentIdx >= 0 ? CAPTIONS[currentIdx] : null;
  const previous = currentIdx > 0 ? CAPTIONS[currentIdx - 1] : null;

  // Before playing (or once it's over) the finished ticket shows; while
  // playing it fills in as the call goes.
  const live = started && !ended;
  const at = (t: number) => !live || time >= t;

  function play(fromStart = false) {
    const a = audioRef.current;
    if (!a) return;
    if (fromStart || a.ended) a.currentTime = 0;
    setStarted(true);
    setEnded(false);
    a.play().then(() => setPlaying(true)).catch(() => {});
  }

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) play();
    else { a.pause(); setPlaying(false); }
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const a = audioRef.current;
    if (!a || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    a.currentTime = Math.max(0, Math.min(duration, ((e.clientX - rect.left) / rect.width) * duration));
    setTime(a.currentTime);
    setStarted(true);
    setEnded(false);
  }

  const speaker = (s: Speaker) => (s === "ai" ? "HavnLine" : "Caller");

  return (
    <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr] lg:items-stretch">
      {/* Player + subtitles */}
      <div className="flex flex-col rounded-2xl border border-border bg-paper p-5 shadow-card sm:p-6">
        {hasAudio ? (
          <div className="flex items-center gap-3">
            <button
              onClick={toggle}
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-sm transition-colors hover:bg-brand-dark"
              aria-label={playing ? "Pause the call" : "Play the call"}
            >
              {playing ? <Pause className="h-6 w-6" /> : <Play className="ml-0.5 h-6 w-6" />}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[14px] font-semibold text-ink">
                  <Volume2 className="h-4 w-4 text-brand" /> {started ? "A real call to HavnLine" : "Listen to a real call"}
                </span>
                <span className="text-[12px] tabular-nums text-text-faint">{fmt(time)} / {fmt(duration)}</span>
              </div>
              <div className="mt-2 h-2 cursor-pointer overflow-hidden rounded-full bg-brand-soft" onClick={seek} role="slider" aria-label="Call position" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(time)}>
                <div className="h-full rounded-full bg-brand transition-[width] duration-200" style={{ width: `${duration ? (time / duration) * 100 : 0}%` }} />
              </div>
            </div>
            {started && (
              <button onClick={() => play(true)} className="rounded-full p-2 text-text-faint hover:bg-card hover:text-ink" aria-label="Play from the start">
                <RotateCcw className="h-4 w-4" />
              </button>
            )}
            <audio
              ref={audioRef}
              src={DEMO_AUDIO_SRC}
              preload="metadata"
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 54)}
              onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
              onEnded={() => { setPlaying(false); setEnded(true); }}
            />
          </div>
        ) : null}

        {/* Subtitles: the line being said, and the one before it, faded. */}
        <div className="mt-6 flex min-h-[150px] flex-1 flex-col items-center justify-center text-center" aria-live="polite">
          {!started || !current ? (
            <p className="max-w-md text-[15px] text-text-muted">
              {hasAudio ? "Press play to hear an actual order being taken. The words show up here as they're spoken." : "An actual order, taken by HavnLine over the phone."}
            </p>
          ) : (
            <>
              {previous && (
                <p key={`p-${currentIdx}`} className="mb-3 max-w-xl text-[13px] leading-snug text-text-faint">
                  <span className="mr-1.5 font-semibold uppercase tracking-wide">{speaker(previous.from)}:</span>{previous.text}
                </p>
              )}
              <span className={`mb-1.5 inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${current.from === "ai" ? "bg-brand text-white" : "bg-ink text-white"}`}>
                {speaker(current.from)}
              </span>
              <p key={`c-${currentIdx}`} className="max-w-xl animate-fade-up font-display text-[20px] font-semibold leading-snug text-ink sm:text-[22px]">
                {current.text}
              </p>
            </>
          )}
        </div>
        {ended && (
          <p className="mt-4 text-center text-[12.5px] text-text-muted">
            That&apos;s the whole call. The customer pays from the text, and the ticket prints in the kitchen.
          </p>
        )}
      </div>

      {/* The ticket, filling in as the order is taken */}
      <div className="flex flex-col rounded-2xl border border-border bg-paper p-5 shadow-card sm:p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
            <Printer className="h-3.5 w-3.5" /> Kitchen ticket
          </div>
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${at(TICKET.linkSent) ? "bg-success-soft text-success" : at(TICKET.confirmed) ? "bg-brand-soft text-brand-dark" : live ? "bg-amber-50 text-amber-700" : "bg-success-soft text-success"}`}>
            {at(TICKET.linkSent) ? "Ready to print when paid" : at(TICKET.confirmed) ? "Confirmed" : "Taking the order…"}
          </span>
        </div>

        <div className="mt-4 flex-1 rounded-xl border border-dashed border-border bg-card p-4 font-mono text-[13px] leading-relaxed text-text">
          <div className="flex justify-between text-text-faint"><span>ORDER #1042</span><span>PICKUP</span></div>
          <div className="mt-2 min-h-[64px] border-t border-border-soft pt-2">
            <div className={`transition-all duration-500 ${at(TICKET.item) ? "translate-x-0 opacity-100" : "-translate-x-2 opacity-0"}`}>1x Cheeseburger</div>
            <div className={`pl-3 text-text-muted transition-all duration-500 ${at(TICKET.change) ? "translate-x-0 opacity-100" : "-translate-x-2 opacity-0"}`}>- No tomatoes</div>
            {live && !at(TICKET.item) && <div className="text-text-faint">Listening…</div>}
          </div>
          <div className={`mt-2 flex justify-between border-t border-border-soft pt-2 font-semibold transition-all duration-500 ${at(TICKET.total) ? "opacity-100" : "opacity-0"}`}>
            <span>Subtotal</span><span>$14.99</span>
          </div>
        </div>

        <ul className="mt-4 space-y-2 text-[12.5px]">
          {[
            { show: at(TICKET.item), text: "Item added the moment it's ordered" },
            { show: at(TICKET.change), text: "Changes noted on the ticket" },
            { show: at(TICKET.confirmed), text: "Read back and confirmed by the caller" },
            { show: at(TICKET.linkSent), text: "Payment link texted, and it prints once paid", icon: MessageSquareText },
          ].map((s) => {
            const Icon = s.icon || Check;
            return (
              <li key={s.text} className={`flex items-center gap-2 transition-opacity duration-500 ${s.show ? "text-text opacity-100" : "text-text-faint opacity-40"}`}>
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${s.show ? "bg-success-soft text-success" : "bg-border-soft text-text-faint"}`}><Icon className="h-3 w-3" /></span>
                {s.text}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
