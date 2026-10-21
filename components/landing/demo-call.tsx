"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, Printer, PhoneCall, Volume2, RotateCcw } from "lucide-react";

/**
 * A real test call to HavnLine (recorded from the caller's phone), with
 * captions that follow the audio: the line being spoken is highlighted and
 * kept in view. Without playing, the whole conversation reads as a
 * transcript. The kitchen ticket shows what the order became.
 *
 * Each line's `at` is when it starts in the recording, in seconds (taken
 * from a transcript of the audio and the pauses between speakers).
 */
export const DEMO_AUDIO_SRC = "/demo-call.mp3";

const LINES: { from: "ai" | "caller"; at: number; text: string }[] = [
  { from: "ai", at: 0, text: "Hi, thanks for calling Durresi Coney Island! You're talking to our AI order line. I can take your order or answer questions, and you can ask for a person anytime. What can I get started for you?" },
  { from: "caller", at: 10.8, text: "I'd like to order a cheeseburger." },
  { from: "ai", at: 14.7, text: "Great. For the cheeseburger, anything you'd like on it, or any way you'd like it prepared?" },
  { from: "caller", at: 19.9, text: "What comes on the cheeseburger?" },
  { from: "ai", at: 22.3, text: "The cheeseburger comes with lettuce, tomato, mayo, onions and pickles. Want it that way, or should I leave anything off?" },
  { from: "caller", at: 29.9, text: "No tomatoes." },
  { from: "ai", at: 32.4, text: "Got it, no tomatoes on that one. Anything else I can get for you?" },
  { from: "caller", at: 36.0, text: "No, thanks." },
  { from: "ai", at: 38.0, text: "Perfect. So that's one cheeseburger with no tomatoes, which comes to $14.99 before tax. Does that sound right?" },
  { from: "caller", at: 45.7, text: "Yes." },
  { from: "ai", at: 47.2, text: "Great! Can I get your name and the best number to text your payment link to? Your order goes to the kitchen as soon as it's paid." },
];
/** When the ticket "prints" during playback: once the order is confirmed. */
const TICKET_AT = 46.4;

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function DemoCall() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [hasAudio, setHasAudio] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(54);

  // Show the player only if the recording is really there.
  useEffect(() => {
    fetch(DEMO_AUDIO_SRC, { method: "HEAD" })
      .then((r) => setHasAudio(r.ok && (r.headers.get("content-type") || "").startsWith("audio")))
      .catch(() => {});
  }, []);

  // The line being spoken right now (-1 before the call starts).
  const current = started ? LINES.reduce((idx, l, i) => (l.at <= time + 0.05 ? i : idx), -1) : -1;

  // Keep the spoken line in view inside the transcript box (not the page).
  useEffect(() => {
    if (!started || current < 0) return;
    const box = listRef.current;
    const el = lineRefs.current[current];
    if (!box || !el) return;
    const target = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
    box.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, [current, started]);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      if (a.ended) a.currentTime = 0;
      setStarted(true);
      a.play().then(() => setPlaying(true)).catch(() => {});
    } else {
      a.pause();
      setPlaying(false);
    }
  }

  function restart() {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = 0;
    setTime(0);
    setStarted(true);
    a.play().then(() => setPlaying(true)).catch(() => {});
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const a = audioRef.current;
    if (!a || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    a.currentTime = Math.max(0, Math.min(duration, ((e.clientX - rect.left) / rect.width) * duration));
    setTime(a.currentTime);
    setStarted(true);
  }

  // Before playing, the ticket is shown as the finished result; while the
  // call plays it "prints" once the order is confirmed.
  const ticketShown = !started || time >= TICKET_AT || (!playing && time >= duration - 0.5);

  return (
    <div>
      {hasAudio && (
        <div className="mx-auto mb-6 flex max-w-xl items-center gap-3 rounded-2xl border border-brand/30 bg-brand-50 p-2 pr-4 shadow-card">
          <button
            onClick={toggle}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-sm transition-colors hover:bg-brand-dark"
            aria-label={playing ? "Pause the call" : "Play the call"}
          >
            {playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ink">
                <Volume2 className="h-4 w-4 text-brand" /> {started ? "A real call to HavnLine" : "Listen to a real call"}
              </span>
              <span className="text-[11.5px] tabular-nums text-text-faint">{fmt(time)} / {fmt(duration)}</span>
            </div>
            <div className="mt-2 h-2 cursor-pointer overflow-hidden rounded-full bg-brand-soft" onClick={seek} role="slider" aria-label="Call position" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(time)}>
              <div className="h-full rounded-full bg-brand transition-[width] duration-200" style={{ width: `${duration ? (time / duration) * 100 : 0}%` }} />
            </div>
          </div>
          {started && (
            <button onClick={restart} className="rounded-full p-2 text-text-faint hover:bg-white hover:text-ink" aria-label="Play from the start">
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
          <audio
            ref={audioRef}
            src={DEMO_AUDIO_SRC}
            preload="metadata"
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 54)}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onEnded={() => setPlaying(false)}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_auto_1fr] lg:items-center">
        <div className="rounded-2xl border border-border bg-paper p-5 shadow-card">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
            <PhoneCall className="h-3.5 w-3.5" /> The call, word for word
          </div>
          <div ref={listRef} className="relative mt-3 max-h-[380px] space-y-2.5 overflow-y-auto pr-1">
            {LINES.map((line, i) => {
              const ai = line.from === "ai";
              const isNow = i === current;
              const upcoming = started && i > current;
              return (
                <div key={i} ref={(el) => { lineRefs.current[i] = el; }} className={`flex ${ai ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed transition-all duration-300 ${
                      ai ? "rounded-br-md bg-brand text-white" : "rounded-bl-md border border-border bg-card text-text"
                    } ${upcoming ? "opacity-35" : "opacity-100"} ${isNow ? (ai ? "ring-2 ring-brand/40 ring-offset-2" : "ring-2 ring-brand/30 ring-offset-2") : ""}`}
                  >
                    <span className={`mb-0.5 block text-[10px] font-semibold uppercase tracking-wide ${ai ? "text-white/70" : "text-text-faint"}`}>{ai ? "HavnLine" : "Caller"}</span>
                    {line.text}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mx-auto hidden h-px w-10 bg-gradient-to-r from-border to-brand lg:block" aria-hidden />

        <div className="rounded-2xl border border-border bg-paper p-5 shadow-card">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
            <Printer className="h-3.5 w-3.5" /> Kitchen ticket
          </div>
          <div className="mt-3 min-h-[150px] overflow-hidden">
            <div className={`rounded-xl border border-dashed border-border bg-card p-4 font-mono text-[12.5px] leading-relaxed text-text transition-all duration-700 ease-out ${ticketShown ? "translate-y-0 opacity-100" : "-translate-y-6 opacity-0"}`}>
              <div className="flex justify-between text-text-faint"><span>ORDER #1042</span><span>PICKUP</span></div>
              <div className="mt-2 border-t border-border-soft pt-2">
                1x Cheeseburger<br />
                <span className="pl-3 text-text-muted">- No tomatoes</span>
              </div>
              <div className="mt-2 flex justify-between border-t border-border-soft pt-2 font-semibold"><span>Subtotal</span><span>$14.99</span></div>
              <div className="mt-1 text-[11px] text-text-faint">PAID BY CARD · TEXT LINK</div>
            </div>
            {!ticketShown && <div className="-mt-[120px] flex h-[120px] items-center justify-center text-[12px] text-text-faint">Waiting for the order…</div>}
          </div>
          <p className="mt-3 text-[11.5px] text-text-faint">The caller pays by the texted link, and the ticket prints in your kitchen the moment it&apos;s paid.</p>
        </div>
      </div>
    </div>
  );
}
