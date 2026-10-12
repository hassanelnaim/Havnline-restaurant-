"use client";

import { WEEKDAY_SHORT } from "@/lib/business/pricing";

/** Seven toggle buttons, Sunday to Saturday. No days selected means "every day". */
export function DayPicker({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
  function toggle(d: number) {
    onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort((a, b) => a - b));
  }
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days of the week">
      {WEEKDAY_SHORT.map((label, d) => {
        const on = value.includes(d);
        return (
          <button
            key={label}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(d)}
            className={`h-8 w-11 rounded-lg border text-[12px] font-medium transition-colors ${on ? "border-brand bg-brand-soft text-brand-dark" : "border-border bg-card text-text-muted hover:border-brand/40"}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
