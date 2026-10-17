"use client";

import { useEffect, useState } from "react";
import { Check, ChefHat, PhoneIncoming, Printer } from "lucide-react";

/**
 * The hero visual: a phone that rings, gets answered by HavnLine, and ends
 * with the order sent to the kitchen — the whole product in four seconds.
 * Loops; holds still on the finished order for anyone who prefers reduced
 * motion.
 */
const STAGES = ["ringing", "answered", "ordering", "sent"] as const;
type Stage = (typeof STAGES)[number];
const STAGE_MS: Record<Stage, number> = { ringing: 1800, answered: 1600, ordering: 2400, sent: 3200 };

export function HeroPhone() {
  const [stage, setStage] = useState<Stage>("sent");

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      setStage(STAGES[i]);
      timer = setTimeout(() => { i = (i + 1) % STAGES.length; next(); }, STAGE_MS[STAGES[i]]);
    };
    next();
    return () => clearTimeout(timer);
  }, []);

  const at = STAGES.indexOf(stage);

  return (
    <div className="relative mx-auto w-full max-w-[300px]" aria-label="A call answered by HavnLine and sent to the kitchen">
      <div className="absolute -inset-8 rounded-[48px] bg-brand/20 blur-3xl" aria-hidden />
      <div className="relative rounded-[40px] border border-[#25324A] bg-[#0E1626] p-3 shadow-2xl">
        <div className="mx-auto mb-3 h-1.5 w-16 rounded-full bg-[#25324A]" aria-hidden />
        <div className="rounded-[30px] bg-gradient-to-b from-[#131C30] to-[#0B1220] p-4">
          <div className="text-center text-[11px] font-medium uppercase tracking-wide text-[#8A93A6]">Tony&apos;s Pizzeria · main line</div>

          {/* Call card */}
          <div className={`mt-4 rounded-2xl border p-3.5 transition-colors duration-500 ${at === 0 ? "border-white/10 bg-white/5" : "border-brand/40 bg-brand/15"}`}>
            <div className="flex items-center gap-3">
              <span className={`flex h-9 w-9 items-center justify-center rounded-full ${at === 0 ? "bg-success text-white animate-pulse-ring" : "bg-brand text-white"}`}>
                {at === 0 ? <PhoneIncoming className="h-4 w-4" /> : <Check className="h-4 w-4" />}
              </span>
              <div>
                <div className="text-[13px] font-semibold text-white">{at === 0 ? "Incoming call…" : "Answered by HavnLine"}</div>
                <div className="text-[11px] text-[#8A93A6]">(845) 555-0142 · 7:12 PM</div>
              </div>
            </div>
          </div>

          {/* Order building up */}
          <div className={`mt-3 rounded-2xl border border-white/10 bg-white/5 p-3.5 transition-opacity duration-500 ${at >= 2 ? "opacity-100" : "opacity-25"}`}>
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[#8A93A6]">Order so far</div>
            <ul className="mt-2 space-y-1 text-[12.5px] text-white">
              <li>1× Large Pepperoni Pizza</li>
              <li>1× Garlic Knots</li>
              <li>1× 2-Liter Coke</li>
            </ul>
            <div className="mt-2 flex justify-between border-t border-white/10 pt-2 text-[12.5px] font-semibold text-white"><span>Total</span><span>$28.75</span></div>
          </div>

          {/* Sent to kitchen */}
          <div className={`mt-3 flex items-center gap-3 rounded-2xl bg-success/15 p-3.5 ring-1 ring-success/40 transition-all duration-500 ${at === 3 ? "translate-y-0 opacity-100" : "translate-y-1 opacity-25"}`}>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-success text-white"><Printer className="h-4 w-4" /></span>
            <div>
              <div className="text-[13px] font-semibold text-white">{at === 3 ? "Sent to the kitchen" : "Kitchen ticket"}</div>
              <div className="flex items-center gap-1 text-[11px] text-[#B8C0D0]"><ChefHat className="h-3 w-3" /> Nobody left the floor</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
