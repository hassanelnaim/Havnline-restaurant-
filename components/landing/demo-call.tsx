"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, Printer, ClipboardList, Volume2 } from "lucide-react";

/**
 * The sample order: chat bubbles appear one at a time when the section
 * scrolls into view, then the kitchen ticket "prints".
 *
 * When a recording is present at DEMO_AUDIO_SRC, a play button appears and
 * the bubbles follow the audio instead (each line shows at its `at` second).
 * Until the file exists the button stays hidden, so nothing looks broken.
 * When the real recording is added, set each line's `at` to when it starts
 * in the audio (and make the words match what's said).
 */
export const DEMO_AUDIO_SRC = "/demo-call.mp3";

const LINES = [
  { from: "caller", at: 3, text: "Hey, can I get a large pepperoni pizza and an order of garlic knots?" },
  { from: "ai", at: 7, text: "You got it — one large pepperoni, one garlic knots. Anything to drink, or any other sides?" },
  { from: "caller", at: 13, text: "Yeah, add a 2-liter Coke." },
  { from: "ai", at: 16, text: "Perfect. So that's a large pepperoni, garlic knots, and a 2-liter Coke — comes to $28.75 for pickup. Sound right?" },
] as const;
const TICKET_AT = 24;
const AUTO_STEP_MS = 1100;

export function DemoCall() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [shown, setShown] = useState(0); // how many lines are visible
  const [ticket, setTicket] = useState(false);
  const [hasAudio, setHasAudio] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  // Show the play button only if the recording really exists.
  useEffect(() => {
    fetch(DEMO_AUDIO_SRC, { method: "HEAD" }).then((r) => setHasAudio(r.ok && (r.headers.get("content-type") || "").startsWith("audio"))).catch(() => {});
  }, []);

  // Without audio: reveal the conversation once, when it scrolls into view.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(LINES.length); setTicket(true); return; }
    let timers: ReturnType<typeof setTimeout>[] = [];
    const io = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      LINES.forEach((_, i) => timers.push(setTimeout(() => setShown((s) => Math.max(s, i + 1)), 300 + i * AUTO_STEP_MS)));
      timers.push(setTimeout(() => setTicket(true), 300 + LINES.length * AUTO_STEP_MS + 300));
    }, { threshold: 0.35 });
    io.observe(el);
    return () => { io.disconnect(); timers.forEach(clearTimeout); timers = []; };
  }, []);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      if (a.ended || a.currentTime === 0) { setShown(0); setTicket(false); a.currentTime = 0; }
      a.play().then(() => setPlaying(true)).catch(() => {});
    } else {
      a.pause();
      setPlaying(false);
    }
  }

  function onTime() {
    const a = audioRef.current;
    if (!a) return;
    const t = a.currentTime;
    setShown(LINES.filter((l) => l.at <= t).length);
    setTicket(t >= TICKET_AT);
    setProgress(a.duration ? t / a.duration : 0);
  }

  return (
    <div ref={sectionRef}>
      {hasAudio && (
        <div className="mx-auto mb-6 flex max-w-md items-center gap-3 rounded-full border border-brand/30 bg-brand-50 p-1.5 pr-5 shadow-card">
          <button onClick={toggle} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-sm hover:bg-brand-dark" aria-label={playing ? "Pause the sample call" : "Play the sample call"}>
            {playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink"><Volume2 className="h-3.5 w-3.5 text-brand" /> {playing ? "Playing a real test order" : "Hear a real test order"}</div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-brand-soft"><div className="h-full rounded-full bg-brand transition-[width] duration-200" style={{ width: `${progress * 100}%` }} /></div>
          </div>
          <audio ref={audioRef} src={DEMO_AUDIO_SRC} preload="none" onTimeUpdate={onTime} onEnded={() => { setPlaying(false); setShown(LINES.length); setTicket(true); }} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
        <div className="rounded-2xl border border-border bg-paper p-5 shadow-card">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
            <ClipboardList className="h-3.5 w-3.5" /> The call
          </div>
          <div className="mt-3 min-h-[240px] space-y-2">
            {LINES.map((line, i) => (
              <div
                key={i}
                className={`flex transition-all duration-500 ${line.from === "ai" ? "justify-end" : "justify-start"} ${i < shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}
              >
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-relaxed ${line.from === "ai" ? "rounded-br-md bg-brand text-white" : "rounded-bl-md border border-border bg-card text-text"}`}>
                  <span className={`mb-0.5 block text-[10px] font-semibold uppercase tracking-wide ${line.from === "ai" ? "text-white/70" : "text-text-faint"}`}>{line.from === "ai" ? "HavnLine" : "Caller"}</span>
                  {line.text}
                </div>
              </div>
            ))}
            {shown < LINES.length && shown > 0 && (
              <div className={`flex ${LINES[shown].from === "ai" ? "justify-end" : "justify-start"}`} aria-hidden>
                <div className="flex gap-1 rounded-2xl bg-card px-3 py-2.5">
                  {[0, 1, 2].map((d) => <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-faint" style={{ animationDelay: `${d * 120}ms` }} />)}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mx-auto hidden h-px w-10 bg-gradient-to-r from-border to-brand lg:block" aria-hidden />

        <div className="rounded-2xl border border-border bg-paper p-5 shadow-card">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
            <Printer className="h-3.5 w-3.5" /> Kitchen ticket
          </div>
          <div className="mt-3 overflow-hidden">
            <div className={`rounded-xl border border-dashed border-border bg-card p-4 font-mono text-[12.5px] leading-relaxed text-text transition-all duration-700 ease-out ${ticket ? "translate-y-0 opacity-100" : "-translate-y-6 opacity-0"}`}>
              <div className="flex justify-between text-text-faint"><span>ORDER #1042</span><span>PICKUP</span></div>
              <div className="mt-2 border-t border-border-soft pt-2">
                1x Large Pepperoni Pizza<br />
                1x Garlic Knots<br />
                1x 2-Liter Coke
              </div>
              <div className="mt-2 flex justify-between border-t border-border-soft pt-2 font-semibold"><span>Total</span><span>$28.75</span></div>
            </div>
            {!ticket && <div className="flex h-[150px] items-center justify-center text-[12px] text-text-faint">Waiting for the order…</div>}
          </div>
          <p className="mt-3 text-[11.5px] text-text-faint">Same format your kitchen already reads. The customer gets the details by text.</p>
        </div>
      </div>
    </div>
  );
}
