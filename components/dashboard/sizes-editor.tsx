"use client";
import { Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SIZE_PRESETS } from "@/lib/menu/sizes";

export interface SizeRow {
  name: string;
  /** Full price in dollars, as typed ("3.49"). */
  price: string;
}

/**
 * Sizes with a full price each (Small $3.49, Large $4.99). Used by the
 * Add item form and the item editor; see lib/menu/sizes.ts for storage.
 */
export function SizesEditor({ rows, onChange }: { rows: SizeRow[]; onChange: (rows: SizeRow[]) => void }) {
  const set = (i: number, patch: Partial<SizeRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  // A preset keeps any prices already typed for sizes with the same name.
  const applyPreset = (names: string[]) => onChange(names.map((n) => ({ name: n, price: rows.find((r) => r.name.toLowerCase() === n.toLowerCase())?.price || "" })));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {SIZE_PRESETS.map((p) => (
          <button
            key={p.join("/")}
            type="button"
            onClick={() => applyPreset(p)}
            className="rounded-full border border-border bg-card px-2.5 py-1 text-[11.5px] text-text-muted hover:border-brand hover:text-brand-dark"
          >
            {p.join(" / ")}
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input aria-label={`Size ${i + 1} name`} placeholder="Size, e.g. Small" value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
            <div className="relative w-28 shrink-0">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-text-faint">$</span>
              <Input aria-label={`${r.name || `Size ${i + 1}`} price`} inputMode="decimal" placeholder="0.00" className="pl-6" value={r.price} onChange={(e) => set(i, { price: e.target.value.replace(/[^0-9.]/g, "") })} />
            </div>
            <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="rounded-md p-1.5 text-text-faint hover:bg-danger-soft hover:text-danger" aria-label="Remove size">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      {rows.length < 8 && (
        <button type="button" onClick={() => onChange([...rows, { name: "", price: "" }])} className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-dark hover:text-brand">
          <Plus className="h-3.5 w-3.5" /> Add a size
        </button>
      )}
      <p className="text-[11.5px] text-text-faint">Enter the full price for each size. Your AI will always ask which size the caller wants.</p>
    </div>
  );
}
