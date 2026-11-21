"use client";
import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { MessageAudience } from "@/lib/admin/messages";

export interface ComposerRestaurant {
  id: string;
  name: string;
  status: string;
  isSuspended: boolean;
}

export type AudienceMode = "all" | "status" | "selected";

export interface AudienceState {
  mode: AudienceMode;
  picked: string[];
  selected: string[];
}

export function toAudience(s: AudienceState): MessageAudience {
  return s.mode === "all" ? { kind: "all" } : s.mode === "status" ? { kind: "status", statuses: s.picked } : { kind: "selected", businessIds: s.selected };
}

export function estimateAudience(s: AudienceState, restaurants: ComposerRestaurant[]): number {
  if (s.mode === "all") return restaurants.length;
  if (s.mode === "selected") return s.selected.length;
  const want = new Set(s.picked);
  return restaurants.filter((r) => (want.has("suspended") && r.isSuspended) || want.has(r.status || "none")).length;
}

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

/** All restaurants / by status / pick restaurants, shared by Messages and Pause AI. */
export function AudiencePicker({
  legend,
  verb,
  restaurants,
  statuses,
  value,
  onChange,
}: {
  legend: string;
  /** "will get this", "will be paused" */
  verb: string;
  restaurants: ComposerRestaurant[];
  statuses: { value: string; label: string }[];
  value: AudienceState;
  onChange: (next: AudienceState) => void;
}) {
  const [search, setSearch] = useState("");
  const shown = restaurants.filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase()));
  const estimate = estimateAudience(value, restaurants);
  return (
    <fieldset>
      <legend className="text-[13px] font-semibold text-ink">{legend}</legend>
      <div className="mt-2 flex flex-wrap gap-2" role="radiogroup">
        {([["all", "All restaurants"], ["status", "By status"], ["selected", "Pick restaurants"]] as const).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={value.mode === mode}
            onClick={() => onChange({ ...value, mode })}
            className={`rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium ${value.mode === mode ? "border-brand bg-brand-soft text-brand" : "border-border text-text-muted hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {value.mode === "status" && (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
          {statuses.map((s) => (
            <label key={s.value} className="flex items-center gap-2 text-[13px] text-ink">
              <input type="checkbox" id={`status-${s.value}`} checked={value.picked.includes(s.value)} onChange={() => onChange({ ...value, picked: toggle(value.picked, s.value) })} />
              {s.label}
            </label>
          ))}
        </div>
      )}

      {value.mode === "selected" && (
        <div className="mt-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
            <Input id="restaurant-search" className="pl-8" placeholder="Search restaurants" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border">
            {shown.length === 0 ? (
              <div className="px-3 py-2.5 text-[12.5px] text-text-muted">No restaurants match.</div>
            ) : (
              shown.map((r) => (
                <label key={r.id} className="flex items-center gap-2.5 border-b border-border px-3 py-2 text-[13px] text-ink last:border-0">
                  <input type="checkbox" checked={value.selected.includes(r.id)} onChange={() => onChange({ ...value, selected: toggle(value.selected, r.id) })} />
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <span className="text-[11.5px] text-text-faint">{r.isSuspended ? "suspended" : r.status || "none"}</span>
                </label>
              ))
            )}
          </div>
        </div>
      )}
      <p className="mt-2 text-[12.5px] text-text-muted">
        {estimate === 1 ? "1 restaurant" : `${estimate} restaurants`} {verb}.
      </p>
    </fieldset>
  );
}
