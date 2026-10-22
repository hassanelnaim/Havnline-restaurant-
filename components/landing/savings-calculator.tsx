"use client";

import { useState } from "react";
import { Clock, BellOff, PhoneIncoming } from "lucide-react";

/**
 * "Your phone, by the numbers": what the phone takes from a restaurant's
 * team, in time and interruptions, using only the visitor's own numbers
 * (no industry statistics, nothing to fact-check, no dollar figures).
 */
function Slider({ label, hint, value, min, max, step = 1, format, onChange }: { label: string; hint?: string; value: number; min: number; max: number; step?: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium text-text">{label}</span>
        <span className="shrink-0 font-display text-[15px] font-semibold text-brand-dark">{format(value)}</span>
      </div>
      {hint && <span className="mt-0.5 block text-[11.5px] text-text-faint">{hint}</span>}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 w-full accent-[#2563EB]" />
    </label>
  );
}

const SHIFT_HOURS = 8;

export function SavingsCalculator() {
  const [ordersPerDay, setOrdersPerDay] = useState(25);
  const [minutesPerCall, setMinutesPerCall] = useState(3);
  const [openDays, setOpenDays] = useState(30);
  const [missedPerDay, setMissedPerDay] = useState(0);

  const hours = (ordersPerDay * minutesPerCall * openDays) / 60;
  const shifts = hours / SHIFT_HOURS;
  const interruptions = ordersPerDay * openDays;
  const missedOrders = missedPerDay * openDays;

  const shiftsText = shifts < 1 ? "less than one full shift" : `about ${Math.round(shifts)} full shift${Math.round(shifts) === 1 ? "" : "s"}`;

  return (
    <div className="grid gap-6 rounded-2xl border border-border bg-card p-6 shadow-card lg:grid-cols-[1fr_1.1fr]">
      <div className="space-y-5">
        <Slider label="Phone orders a day" value={ordersPerDay} min={1} max={150} format={(v) => String(v)} onChange={setOrdersPerDay} />
        <Slider label="Minutes each call takes someone" value={minutesPerCall} min={1} max={8} format={(v) => `${v} min`} onChange={setMinutesPerCall} />
        <Slider label="Days open a month" value={openDays} min={10} max={31} format={(v) => String(v)} onChange={setOpenDays} />
        <div className="border-t border-border-soft pt-5">
          <Slider
            label="Calls missed on a typical day"
            hint="Optional. Your best guess at rush-hour calls nobody gets to."
            value={missedPerDay}
            min={0}
            max={30}
            format={(v) => (v === 0 ? "None" : String(v))}
            onChange={setMissedPerDay}
          />
        </div>
      </div>

      <div className="flex flex-col justify-center rounded-2xl bg-gradient-to-br from-brand to-brand-dark p-6 text-white">
        <div className="text-[12px] font-semibold uppercase tracking-wide text-white/70">Every month, HavnLine gives your team back</div>
        <ul className="mt-4 space-y-5">
          <li className="flex gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15"><Clock className="h-5 w-5" /></span>
            <div>
              <div className="font-display text-[30px] font-semibold leading-none">{Math.round(hours).toLocaleString()} hours</div>
              <div className="mt-1 text-[13px] text-white/80">of phone time, {shiftsText}.</div>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15"><BellOff className="h-5 w-5" /></span>
            <div>
              <div className="font-display text-[30px] font-semibold leading-none">{interruptions.toLocaleString()}</div>
              <div className="mt-1 text-[13px] text-white/80">interruptions your kitchen and counter skip. Nobody stops cooking or serving to grab the phone.</div>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15"><PhoneIncoming className="h-5 w-5" /></span>
            <div>
              {missedOrders > 0 ? (
                <>
                  <div className="font-display text-[30px] font-semibold leading-none">~{missedOrders.toLocaleString()} orders</div>
                  <div className="mt-1 text-[13px] text-white/80">from rush-hour calls that used to go unanswered. HavnLine picks up every one, even when three lines ring at once.</div>
                </>
              ) : (
                <>
                  <div className="font-display text-[20px] font-semibold leading-tight">Every call answered</div>
                  <div className="mt-1 text-[13px] text-white/80">even in the rush, even when three lines ring at once. Miss calls when it&apos;s busy? Set the last slider.</div>
                </>
              )}
            </div>
          </li>
        </ul>
      </div>
    </div>
  );
}
