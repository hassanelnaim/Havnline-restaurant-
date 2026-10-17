"use client";

import { useState } from "react";
import { Clock } from "lucide-react";

/**
 * "What it saves you", using only the visitor's own numbers — no industry
 * statistics, nothing to fact-check.
 */
function Slider({ label, value, min, max, step = 1, format, onChange }: { label: string; value: number; min: number; max: number; step?: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-text">{label}</span>
        <span className="font-display text-[15px] font-semibold text-brand-dark">{format(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 w-full accent-[#2563EB]" />
    </label>
  );
}

export function SavingsCalculator({ monthlyPriceDisplay, feePercentDisplay }: { monthlyPriceDisplay: string; feePercentDisplay: string }) {
  const [ordersPerDay, setOrdersPerDay] = useState(25);
  const [minutesPerCall, setMinutesPerCall] = useState(3);
  const [hourlyWage, setHourlyWage] = useState(16);
  const [openDays, setOpenDays] = useState(30);

  const hours = (ordersPerDay * minutesPerCall * openDays) / 60;
  const staffCost = hours * hourlyWage;

  return (
    <div className="grid gap-6 rounded-2xl border border-border bg-card p-6 shadow-card lg:grid-cols-[1.2fr_1fr]">
      <div className="space-y-5">
        <Slider label="Phone orders a day" value={ordersPerDay} min={1} max={150} format={(v) => String(v)} onChange={setOrdersPerDay} />
        <Slider label="Minutes each call takes someone" value={minutesPerCall} min={1} max={8} format={(v) => `${v} min`} onChange={setMinutesPerCall} />
        <Slider label="Days open a month" value={openDays} min={10} max={31} format={(v) => String(v)} onChange={setOpenDays} />
        <Slider label="Hourly pay of whoever answers" value={hourlyWage} min={8} max={35} format={(v) => `$${v}/hr`} onChange={setHourlyWage} />
      </div>
      <div className="flex flex-col justify-center rounded-2xl bg-gradient-to-br from-brand to-brand-dark p-6 text-white">
        <Clock className="h-6 w-6 text-white/80" />
        <div className="mt-3 text-[13px] text-white/80">Your team gets back about</div>
        <div className="font-display text-[40px] font-semibold leading-tight">{Math.round(hours).toLocaleString()} hours</div>
        <div className="text-[13px] text-white/80">a month — roughly <span className="font-semibold text-white">${Math.round(staffCost).toLocaleString()}</span> of paid time spent on the phone instead of with guests.</div>
        <div className="mt-4 border-t border-white/20 pt-3 text-[12px] text-white/75">HavnLine: {monthlyPriceDisplay}/month + {feePercentDisplay} per paid phone order.</div>
      </div>
    </div>
  );
}
