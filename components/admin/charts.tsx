"use client";

import { useState } from "react";
import { SERIES } from "@/lib/admin/chartColors";

/**
 * Small hand-built charts for the admin pages (no chart library in the
 * app; same approach as components/dashboard/sales-card.tsx). Bars grow
 * from the baseline with rounded tops, sit 2px apart, and each one has a
 * hover/tap tooltip and a screen-reader label.
 */


const IN_PROGRESS = (color: string) => ({
  backgroundImage: `repeating-linear-gradient(135deg, rgba(255,255,255,0.45) 0 5px, rgba(255,255,255,0) 5px 10px), linear-gradient(${color}, ${color})`,
});

export interface Bar {
  key: string;
  /** Axis label; empty to skip (only every few are shown on dense charts). */
  label: string;
  value: number;
  /** Lines shown in the tooltip, first one bold. */
  tooltip: string[];
  /** The period still in progress (drawn striped). */
  inProgress?: boolean;
  /** Called out in a darker shade, e.g. the busiest hour. */
  emphasis?: boolean;
}

type Align = "left" | "center" | "right";
// Bars near either edge open their tooltip inward, so it never hangs off the card.
const alignOf = (i: number, n: number): Align => (i < 3 ? "left" : i >= n - 3 ? "right" : "center");
const ALIGN: Record<Align, string> = { left: "left-0", center: "left-1/2 -translate-x-1/2", right: "right-0" };

function Tooltip({ lines, align }: { lines: string[]; align: Align }) {
  return (
    <div className={`pointer-events-none absolute bottom-full z-10 mb-2 ${ALIGN[align]} whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-[11.5px] text-white shadow-popover`}>
      <div className="font-semibold">{lines[0]}</div>
      {lines.slice(1).map((l) => (
        <div key={l} className="text-[#B8C0D0]">{l}</div>
      ))}
    </div>
  );
}

export function BarChart({ bars, height = 140, color = SERIES.calls, emphasisColor = "#1E3A8A", ariaLabel }: { bars: Bar[]; height?: number; color?: string; emphasisColor?: string; ariaLabel: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div role="img" aria-label={ariaLabel}>
      <div className="relative flex items-end gap-[2px] border-b border-border" style={{ height }}>
        {bars.map((b, i) => {
          const pct = b.value === 0 ? 0 : Math.max(3, (b.value / max) * 100);
          const fill = b.emphasis ? emphasisColor : color;
          return (
            <div
              key={b.key}
              className="relative flex h-full flex-1 cursor-default items-end justify-center"
              onMouseEnter={() => setHover(b.key)}
              onMouseLeave={() => setHover(null)}
              onClick={() => setHover((h) => (h === b.key ? null : b.key))}
              aria-label={b.tooltip.join(", ")}
            >
              {hover === b.key && <Tooltip lines={b.tooltip} align={alignOf(i, bars.length)} />}
              <div
                className={`w-full max-w-[28px] rounded-t-[4px] transition-opacity ${hover && hover !== b.key ? "opacity-60" : ""}`}
                style={{ height: `${pct}%`, ...(b.inProgress ? IN_PROGRESS(fill) : { background: fill }) }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-[2px]">
        {bars.map((b, i) => (
          <div key={b.key} className={`flex-1 whitespace-nowrap text-[10.5px] text-text-faint ${i === 0 ? "text-left" : i === bars.length - 1 ? "text-right" : "text-center"}`}>
            {b.label}
          </div>
        ))}
      </div>
    </div>
  );
}

export interface PairedBar {
  key: string;
  label: string;
  a: number;
  b: number;
  tooltip: string[];
  inProgress?: boolean;
}

/** Two measures side by side per period (calls and orders), one scale, with a legend. */
export function PairedBarChart({ bars, height = 160, names, ariaLabel }: { bars: PairedBar[]; height?: number; names: [string, string]; ariaLabel: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...bars.flatMap((x) => [x.a, x.b]));
  const h = (v: number) => (v === 0 ? 0 : Math.max(3, (v / max) * 100));
  return (
    <div role="img" aria-label={ariaLabel}>
      <div className="mb-3 flex items-center gap-4 text-[11.5px] text-text-muted">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES.calls }} />{names[0]}</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES.orders }} />{names[1]}</span>
      </div>
      <div className="relative flex items-end gap-1.5 border-b border-border" style={{ height }}>
        {bars.map((x, i) => (
          <div
            key={x.key}
            className="relative flex h-full flex-1 items-end justify-center gap-[2px]"
            onMouseEnter={() => setHover(x.key)}
            onMouseLeave={() => setHover(null)}
            onClick={() => setHover((k) => (k === x.key ? null : x.key))}
            aria-label={x.tooltip.join(", ")}
          >
            {hover === x.key && <Tooltip lines={x.tooltip} align={alignOf(i, bars.length)} />}
            {([["a", SERIES.calls], ["b", SERIES.orders]] as const).map(([k, c]) => (
              <div
                key={k}
                className={`w-1/2 max-w-[14px] rounded-t-[4px] transition-opacity ${hover && hover !== x.key ? "opacity-60" : ""}`}
                style={{ height: `${h(x[k])}%`, ...(x.inProgress ? IN_PROGRESS(c) : { background: c }) }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {bars.map((x) => (
          <div key={x.key} className="flex-1 whitespace-nowrap text-center text-[10.5px] text-text-faint">{x.label}</div>
        ))}
      </div>
    </div>
  );
}
