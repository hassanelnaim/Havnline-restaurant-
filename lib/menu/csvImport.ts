/**
 * Reads a menu exported from a POS or spreadsheet as CSV (name, price,
 * group/category, description columns) straight into import items, with
 * no AI involved: exact names and prices, instant, any size.
 *
 * POS exports often list the same item several times: once as a real menu
 * item and again inside option lists (a "{Combo} Make A Combo" or
 * "{Breakfast} Potato Choice" group, usually at $0.00). Groups written in
 * braces are treated as option lists and skipped, and a name that appears
 * more than once keeps its priced copy.
 *
 * Client-safe: no server imports.
 */
import type { ExtractedMenuItem } from "@/lib/ai/websiteImport";

/** Splits CSV text into rows of cells, handling quotes, doubled quotes and newlines inside quotes. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

function findColumn(headers: string[], tests: RegExp[], avoid?: RegExp): number {
  for (const test of tests) {
    const i = headers.findIndex((h) => test.test(h) && !(avoid && avoid.test(h)));
    if (i >= 0) return i;
  }
  return -1;
}

export interface CsvMenuResult {
  items: ExtractedMenuItem[];
  /** Rows skipped because they belong to an option list like "{Combo} Make A Combo". */
  skippedOptionRows: number;
  /** Rows dropped as duplicates of an item already in the list. */
  duplicateRows: number;
}

/** Null when the file doesn't look like a menu (no name or price column found). */
export function parseMenuCsv(text: string): CsvMenuResult | null {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return null;
  const headers = rows[0].map((h) => h.trim().toLowerCase());

  const nameCol = findColumn(headers, [/^(menu )?item( name)?$/, /^name$/, /item name/, /name/], /category|group|modifier/);
  const priceCol = findColumn(headers, [/^price$/, /price/, /^amount$/], /cost/);
  if (nameCol < 0 || priceCol < 0) return null;
  const categoryCol = findColumn(headers, [/^category$/, /^menu group$/, /^menu category$/, /^section$/, /category/, /group/], /report|modifier/);
  const descCol = findColumn(headers, [/^description$/, /desc/]);

  let skippedOptionRows = 0;
  const byName = new Map<string, ExtractedMenuItem>();
  const order: string[] = [];
  let parsedRows = 0;

  for (const r of rows.slice(1)) {
    const name = (r[nameCol] || "").trim().replace(/\s+/g, " ");
    if (!name) continue;
    const category = categoryCol >= 0 ? (r[categoryCol] || "").trim() : "";
    if (/^\{.*\}/.test(category)) { skippedOptionRows++; continue; }
    parsedRows++;
    const priceNum = parseFloat((r[priceCol] || "").replace(/[$,\s]/g, ""));
    const priceDollars = Number.isFinite(priceNum) ? priceNum.toFixed(2) : "";
    const item: ExtractedMenuItem = {
      name,
      description: descCol >= 0 ? (r[descCol] || "").trim().slice(0, 300) : "",
      priceDollars,
      category,
      modifierGroups: [],
    };
    const key = name.toLowerCase();
    const existing = byName.get(key);
    if (!existing) { byName.set(key, item); order.push(key); continue; }
    // Keep the priced copy over a $0.00 / blank one.
    const existingPrice = parseFloat(existing.priceDollars) || 0;
    if (existingPrice === 0 && (priceNum || 0) > 0) byName.set(key, { ...item, category: item.category || existing.category });
  }

  const items = order.map((k) => byName.get(k)!);
  return { items, skippedOptionRows, duplicateRows: parsedRows - items.length };
}
