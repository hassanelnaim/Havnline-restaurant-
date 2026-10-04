"use client";

import { useMemo, useState } from "react";
import { Calculator } from "lucide-react";

export interface CalculatorMenuItem {
  id: string;
  name: string;
  priceCents: number;
  /** Average units sold per week over the trailing window, for the "projected weekly profit" line — 0 for an item with no recent sales. */
  avgWeeklyUnits: number;
}

const CUSTOM_ITEM_ID = "__custom__";

/**
 * A small interactive margin/profit tool for the dashboard — replacing
 * "Recent orders," which just listed things the owner already knows
 * about. Picking a real menu item prefills its actual price and recent
 * sales volume so the projection is grounded in this business's own
 * numbers; "Custom item" is there for modeling something not on the
 * menu yet (a potential special) without needing to add it first.
 */
export function CostProfitCalculator({ items }: { items: CalculatorMenuItem[] }) {
  const [selectedId, setSelectedId] = useState<string>(items[0]?.id ?? CUSTOM_ITEM_ID);
  const selected = items.find((i) => i.id === selectedId);

  const [priceInput, setPriceInput] = useState<string>(selected ? (selected.priceCents / 100).toFixed(2) : "0.00");
  const [costInput, setCostInput] = useState<string>("0.00");
  const [discountInput, setDiscountInput] = useState<string>("0");
  const [weeklyUnitsInput, setWeeklyUnitsInput] = useState<string>(selected ? String(Math.round(selected.avgWeeklyUnits)) : "0");

  function handleSelect(id: string) {
    setSelectedId(id);
    const next = items.find((i) => i.id === id);
    setPriceInput(next ? (next.priceCents / 100).toFixed(2) : "0.00");
    setWeeklyUnitsInput(next ? String(Math.round(next.avgWeeklyUnits)) : "0");
  }

  const results = useMemo(() => {
    const price = parseFloat(priceInput) || 0;
    const cost = parseFloat(costInput) || 0;
    const discountPct = Math.min(100, Math.max(0, parseFloat(discountInput) || 0));
    const weeklyUnits = Math.max(0, parseFloat(weeklyUnitsInput) || 0);

    const effectivePrice = price * (1 - discountPct / 100);
    const profitPerUnit = effectivePrice - cost;
    const marginPct = effectivePrice > 0 ? (profitPerUnit / effectivePrice) * 100 : 0;
    const weeklyProfit = profitPerUnit * weeklyUnits;

    return { profitPerUnit, marginPct, weeklyProfit, effectivePrice };
  }, [priceInput, costInput, discountInput, weeklyUnitsInput]);

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-[15px] font-semibold text-ink">Cost &amp; profit calculator</h2>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-soft text-brand-dark">
          <Calculator className="h-4 w-4" />
        </div>
      </div>

      <label className="block text-[11.5px] font-medium text-text-faint">Item</label>
      <select
        value={selectedId}
        onChange={(e) => handleSelect(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border bg-paper px-3 py-2 text-[13px] text-text"
      >
        {items.map((item) => (
          <option key={item.id} value={item.id}>{item.name}</option>
        ))}
        <option value={CUSTOM_ITEM_ID}>Custom item...</option>
      </select>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11.5px] font-medium text-text-faint">Sell price ($)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-paper px-3 py-2 text-[13px] text-text"
          />
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-text-faint">Cost to make ($)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={costInput}
            onChange={(e) => setCostInput(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-paper px-3 py-2 text-[13px] text-text"
          />
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-text-faint">Discount, if any (%)</label>
          <input
            type="number"
            step="1"
            min="0"
            max="100"
            value={discountInput}
            onChange={(e) => setDiscountInput(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-paper px-3 py-2 text-[13px] text-text"
          />
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-text-faint">Est. units/week</label>
          <input
            type="number"
            step="1"
            min="0"
            value={weeklyUnitsInput}
            onChange={(e) => setWeeklyUnitsInput(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-paper px-3 py-2 text-[13px] text-text"
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 rounded-xl bg-paper p-3">
        <div>
          <div className="text-[11px] text-text-faint">Profit / unit</div>
          <div className="mt-0.5 font-display text-[16px] font-semibold text-ink">${results.profitPerUnit.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[11px] text-text-faint">Margin</div>
          <div className="mt-0.5 font-display text-[16px] font-semibold text-ink">{results.marginPct.toFixed(0)}%</div>
        </div>
        <div>
          <div className="text-[11px] text-text-faint">Est. profit/week</div>
          <div className="mt-0.5 font-display text-[16px] font-semibold text-ink">${results.weeklyProfit.toFixed(2)}</div>
        </div>
      </div>
      {selected && selected.avgWeeklyUnits > 0 && (
        <p className="mt-2 text-[11px] text-text-faint">Units/week prefilled from this item&apos;s real recent sales — edit it to model a change in volume.</p>
      )}
    </div>
  );
}
