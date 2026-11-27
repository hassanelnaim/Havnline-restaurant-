"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Plus, Search, X, ChevronRight, Clock, Trash2, Unlink, Loader2, UtensilsCrossed, Copy as CopyIcon } from "lucide-react";
import type { DbMenuCategory, MenuItemWithModifiers } from "@/lib/database/types";
import type { AddonTemplate } from "@/lib/data/menu";
import {
  addMenuItemAction, addMenuCategoryAction, updateMenuItemAction, deleteMenuItemAction,
  setItemSizesAction, setItemComboAction, copyItemSizesAction, updateMenuItemTimePricingAction,
  attachAddonTemplateAction, detachAddonTemplateAction, addModifierGroupAction, deleteModifierGroupAction,
} from "@/app/actions/menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/dashboard/empty-state";
import { DayPicker } from "@/components/dashboard/day-picker";
import { SizesEditor, type SizeRow } from "@/components/dashboard/sizes-editor";
import { readSizes, priceRangeText, isSizeGroup, validateSizes } from "@/lib/menu/sizes";
import { readCombo, isComboGroup } from "@/lib/menu/combo";
import { menuNameKey } from "@/lib/menu/importDedupe";
import { describeTimePricing } from "@/lib/business/pricing";

/**
 * Menu > Menu items: categories down the left (one row on a phone), the
 * chosen category's items on the right, and one side panel for adding or
 * editing an item. In the panel each extra (combo, sizes, add-ons, special
 * price) is its own section with an on/off switch, so what's set up is
 * obvious and a combo can be set while adding the item.
 */

const ALL = "__all__";
const UNCATEGORIZED = "__uncategorized__";
const NEW = "__new__";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const dollars = (cents: number) => (cents / 100).toFixed(2);
const toCents = (v: string) => {
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && String(v).trim() !== "" ? Math.round(n * 100) : null;
};

type PanelState = { mode: "add"; categoryId: string } | { mode: "edit"; itemId: string } | null;

export function MenuItemsTab({
  items,
  categories,
  addonTemplates,
  onToggle,
  onRefresh,
  onRemoved,
  onlyUnpriced,
}: {
  items: MenuItemWithModifiers[];
  categories: DbMenuCategory[];
  addonTemplates: AddonTemplate[];
  onToggle: (id: string, active: boolean) => void;
  onRefresh: () => void;
  onRemoved: (id: string) => void;
  onlyUnpriced: boolean;
}) {
  const [active, setActive] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [panel, setPanel] = useState<PanelState>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [catError, setCatError] = useState<string | null>(null);
  const [catBusy, setCatBusy] = useState(false);
  const [, startTransition] = useTransition();

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.category_id || UNCATEGORIZED, (m.get(i.category_id || UNCATEGORIZED) || 0) + 1);
    return m;
  }, [items]);
  const navEntries = useMemo(() => {
    const list = [{ key: ALL, name: "All items", count: items.length }, ...categories.map((c) => ({ key: c.id, name: c.name, count: counts.get(c.id) || 0 }))];
    if (counts.has(UNCATEGORIZED)) list.push({ key: UNCATEGORIZED, name: "No category", count: counts.get(UNCATEGORIZED)! });
    return list;
  }, [items.length, categories, counts]);
  const current = navEntries.some((e) => e.key === active) ? active : ALL;

  const q = search.trim().toLowerCase();
  const searching = q.length > 0;
  const isUnpriced = (i: MenuItemWithModifiers) => i.price_cents === 0 && !readSizes(i) && !i.special_price_cents;
  const shown = items.filter((i) => {
    if (onlyUnpriced && !isUnpriced(i)) return false;
    if (searching) return i.name.toLowerCase().includes(q) || (i.description || "").toLowerCase().includes(q);
    if (current === ALL) return true;
    return (i.category_id || UNCATEGORIZED) === current;
  });
  const catName = (id: string | null) => (id ? categories.find((c) => c.id === id)?.name || "No category" : "No category");
  const title = searching ? `Results for “${search.trim()}”` : onlyUnpriced ? "Items with no price" : navEntries.find((e) => e.key === current)?.name || "All items";

  function addCategory() {
    if (!newCatName.trim()) { setCatError("Type a name, like Desserts."); return; }
    setCatBusy(true);
    setCatError(null);
    startTransition(async () => {
      const r = await addMenuCategoryAction(newCatName);
      setCatBusy(false);
      if (!r.success) { setCatError(r.error || "Couldn't add that category."); return; }
      setNewCatName("");
      setNewCatOpen(false);
      if (r.categoryId) setActive(r.categoryId);
      onRefresh();
    });
  }

  const editing = panel?.mode === "edit" ? items.find((i) => i.id === panel.itemId) || null : null;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      {/* Categories: a column on a computer, one scrolling row on a phone. Every entry the same size. */}
      <nav aria-label="Menu categories" className="min-w-0 lg:sticky lg:top-4">
        <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:rounded-2xl lg:border lg:border-border lg:bg-card lg:p-2 lg:pb-2">
          {navEntries.map((e) => {
            const on = !searching && e.key === current;
            return (
              <button
                key={e.key}
                type="button"
                aria-current={on ? "true" : undefined}
                onClick={() => { setActive(e.key); setSearch(""); }}
                className={`flex h-10 w-40 shrink-0 items-center justify-between gap-2 rounded-lg border px-3 text-left text-[13.5px] transition-colors lg:w-full lg:border-transparent ${
                  on ? "border-brand bg-brand-soft font-semibold text-brand-dark" : "border-border bg-card font-medium text-text hover:bg-paper"
                }`}
              >
                <span className="min-w-0 truncate">{e.name}</span>
                <span className={`shrink-0 text-[12px] tabular-nums ${on ? "text-brand-dark" : "text-text-faint"}`}>{e.count}</span>
              </button>
            );
          })}
          {!newCatOpen ? (
            <button
              type="button"
              onClick={() => { setNewCatOpen(true); setCatError(null); }}
              className="flex h-10 w-40 shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-brand/40 px-3 text-[13px] font-semibold text-brand hover:bg-brand-soft lg:mt-1 lg:w-full lg:border-0 lg:border-t lg:border-solid lg:border-border lg:rounded-none lg:rounded-b-lg"
            >
              <Plus className="h-3.5 w-3.5" /> New category
            </button>
          ) : (
            <div className="w-56 shrink-0 rounded-lg border border-border bg-card p-2 lg:mt-1 lg:w-full">
              <Input id="new-category-name" autoFocus className="h-9" placeholder="e.g. Desserts" value={newCatName} onChange={(e) => setNewCatName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addCategory(); if (e.key === "Escape") setNewCatOpen(false); }} />
              {catError && <p className="mt-1 text-[11.5px] text-danger">{catError}</p>}
              <div className="mt-2 flex gap-1.5">
                <Button size="sm" variant="brand" onClick={addCategory} disabled={catBusy}>{catBusy ? "Adding…" : "Add"}</Button>
                <Button size="sm" variant="ghost" onClick={() => setNewCatOpen(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      </nav>

      <section className="min-w-0 rounded-2xl border border-border bg-card shadow-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3.5 sm:px-5">
          <h2 className="min-w-0 flex-1 truncate font-display text-[16px] font-semibold text-ink">{title}</h2>
          <div className="relative w-full sm:w-60">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search the menu…"
              aria-label="Search the menu"
              className="h-9 w-full rounded-lg border border-border bg-paper pl-8 pr-8 text-[13px] focus:border-brand focus:outline-none"
            />
            {searching && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-faint hover:text-ink" aria-label="Clear search"><X className="h-3.5 w-3.5" /></button>}
          </div>
          <Button variant="brand" onClick={() => setPanel({ mode: "add", categoryId: current === ALL || current === UNCATEGORIZED ? "" : current })}>
            <Plus className="h-4 w-4" /> Add item
          </Button>
        </div>

        {notice && (
          <div role="status" className={`mx-4 mt-3 rounded-lg border px-3.5 py-2.5 text-[12.5px] sm:mx-5 ${notice.kind === "ok" ? "border-success/20 bg-success-soft text-success" : "border-danger/20 bg-danger-soft text-danger"}`}>
            {notice.text}
          </div>
        )}

        {items.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={UtensilsCrossed} title="No menu items yet" description="Add your first item, or import your whole menu from a website or photo in the Import tab." />
          </div>
        ) : shown.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-text-muted">{searching ? `Nothing matches “${search.trim()}”.` : "No items here yet. Use Add item to add one."}</p>
        ) : (
          <ul className="divide-y divide-border-soft">
            {shown.map((item) => (
              <ItemRow key={item.id} item={item} showCategory={searching || current === ALL} categoryName={catName(item.category_id)} onOpen={() => setPanel({ mode: "edit", itemId: item.id })} onToggle={onToggle} />
            ))}
          </ul>
        )}
      </section>

      {panel && (panel.mode === "add" || editing) && (
        <ItemPanel
          key={panel.mode === "edit" ? panel.itemId : "add"}
          item={editing}
          defaultCategoryId={panel.mode === "add" ? panel.categoryId : ""}
          items={items}
          categories={categories}
          addonTemplates={addonTemplates}
          onClose={() => setPanel(null)}
          onRefresh={onRefresh}
          onToggle={onToggle}
          onSaved={(text, kind = "ok") => { setNotice({ kind, text }); setTimeout(() => setNotice(null), 5000); }}
          onDeleted={(id) => { onRemoved(id); setPanel(null); }}
        />
      )}
    </div>
  );
}

function ItemRow({ item, showCategory, categoryName, onOpen, onToggle }: { item: MenuItemWithModifiers; showCategory: boolean; categoryName: string; onOpen: () => void; onToggle: (id: string, active: boolean) => void }) {
  const sizes = readSizes(item);
  const combo = readCombo(item);
  const addonGroups = item.modifier_groups.filter((g) => !isSizeGroup(g) && !isComboGroup(g));
  const special = describeTimePricing({ price_cents: item.price_cents, special_price_cents: item.special_price_cents, special_price_start_time: item.special_price_start_time, special_price_end_time: item.special_price_end_time, special_price_days: item.special_price_days });
  const unpriced = item.price_cents === 0 && !sizes && !item.special_price_cents;
  return (
    <li className={`flex items-center gap-3 px-4 py-3.5 sm:px-5 ${item.is_active ? "" : "bg-paper/60"}`}>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={`Edit ${item.name}`}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className={`text-[14.5px] font-semibold ${item.is_active ? "text-ink" : "text-text-muted"}`}>{item.name}</span>
            {showCategory && <span className="text-[11.5px] text-text-faint">{categoryName}</span>}
            {!item.is_active && <span className="text-[11.5px] font-medium text-text-muted">Off</span>}
          </div>
          {item.description && <div className="mt-0.5 truncate text-[12.5px] text-text-muted">{item.description}</div>}
          {(combo || sizes || addonGroups.length > 0 || special) && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {combo && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11.5px] font-semibold text-amber-800">Combo {money(combo.comboPriceCents)}</span>}
              {sizes && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11.5px] font-semibold text-brand-dark">{sizes.length} sizes</span>}
              {addonGroups.length > 0 && <span className="rounded-full bg-paper px-2 py-0.5 text-[11.5px] font-semibold text-text-muted">{addonGroups.length} add-on group{addonGroups.length === 1 ? "" : "s"}</span>}
              {special && <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11.5px] font-semibold text-success"><Clock className="h-3 w-3" /> Special price</span>}
            </div>
          )}
        </div>
        {unpriced ? (
          <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11.5px] font-semibold text-amber-800">No price</span>
        ) : (
          <span className="w-20 shrink-0 text-right text-[14px] font-bold tabular-nums text-ink">{priceRangeText(item.price_cents, sizes)}</span>
        )}
      </button>
      <Switch checked={item.is_active} onCheckedChange={(v) => onToggle(item.id, v)} aria-label={item.is_active ? `${item.name} is available. Mark unavailable` : `${item.name} is unavailable. Mark available`} />
      <button type="button" onClick={onOpen} className="hidden rounded-md p-1 text-text-faint hover:text-ink sm:block" aria-hidden="true" tabIndex={-1}>
        <ChevronRight className="h-4 w-4" />
      </button>
    </li>
  );
}

/** Category choice: same-size buttons, one tap. Over 12 categories, a search box narrows them. */
function CategoryPicker({ categories, value, onChange, newName, onNewName }: { categories: DbMenuCategory[]; value: string; onChange: (v: string) => void; newName: string; onNewName: (v: string) => void }) {
  const [q, setQ] = useState("");
  const many = categories.length > 12;
  const shown = many && q.trim() ? categories.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase())) : categories;
  const btn = (on: boolean) => `h-9 min-w-0 truncate rounded-lg border px-2 text-[12.5px] transition-colors ${on ? "border-brand bg-brand-soft font-semibold text-brand-dark" : "border-border bg-card font-medium text-text hover:border-brand/40"}`;
  return (
    <div>
      {many && <Input className="mb-2 h-9" placeholder="Find a category…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a category" />}
      <div role="radiogroup" aria-label="Category" className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        <button type="button" role="radio" aria-checked={value === ""} className={btn(value === "")} onClick={() => onChange("")}>No category</button>
        {shown.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={value === c.id} title={c.name} className={btn(value === c.id)} onClick={() => onChange(c.id)}>{c.name}</button>
        ))}
        <button type="button" role="radio" aria-checked={value === NEW} className={`${btn(value === NEW)} ${value === NEW ? "" : "border-dashed text-brand"}`} onClick={() => onChange(NEW)}>+ New category</button>
      </div>
      {value === NEW && <Input id="item-new-category" autoFocus className="mt-2" placeholder="New category name, e.g. Desserts" value={newName} onChange={(e) => onNewName(e.target.value)} />}
    </div>
  );
}

/** One extra (combo, sizes, add-ons, special price): a title, a line saying what it does, and its switch or button. */
function OptionSection({ title, hint, on, onToggle, action, children, id }: { title: string; hint: string; on?: boolean; onToggle?: (v: boolean) => void; action?: React.ReactNode; children?: React.ReactNode; id: string }) {
  return (
    <div className={`rounded-xl border p-4 transition-colors ${on ? "border-brand/30 bg-brand-50" : "border-border bg-card"}`}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-ink" id={`${id}-title`}>{title}</div>
          <div className="text-[12.5px] text-text-muted">{hint}</div>
        </div>
        {onToggle && <Switch id={id} checked={!!on} onCheckedChange={onToggle} aria-labelledby={`${id}-title`} />}
        {action}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

interface PendingGroup {
  name: string;
  required: boolean;
  options: { name: string; priceDelta: string }[];
}

function ItemPanel({
  item,
  defaultCategoryId,
  items,
  categories,
  addonTemplates,
  onClose,
  onRefresh,
  onToggle,
  onSaved,
  onDeleted,
}: {
  item: MenuItemWithModifiers | null;
  defaultCategoryId: string;
  items: MenuItemWithModifiers[];
  categories: DbMenuCategory[];
  addonTemplates: AddonTemplate[];
  onClose: () => void;
  onRefresh: () => void;
  onToggle: (id: string, active: boolean) => void;
  onSaved: (text: string, kind?: "ok" | "error") => void;
  onDeleted: (id: string) => void;
}) {
  const isEdit = !!item;
  const [, startTransition] = useTransition();
  const existingSizes = item ? readSizes(item) : null;
  const existingCombo = item ? readCombo(item) : null;
  const hasSpecial = !!item && item.special_price_cents != null && ((!!item.special_price_start_time && !!item.special_price_end_time) || (item.special_price_days?.length ?? 0) > 0);

  const [name, setName] = useState(item?.name || "");
  const [price, setPrice] = useState(item ? dollars(item.price_cents) : "");
  const [description, setDescription] = useState(item?.description || "");
  const [categoryId, setCategoryId] = useState(item ? item.category_id || "" : defaultCategoryId);
  const [newCategory, setNewCategory] = useState("");

  const [sizesOn, setSizesOn] = useState(!!existingSizes);
  const [sizeRows, setSizeRows] = useState<SizeRow[]>(existingSizes ? existingSizes.map((s) => ({ name: s.name, price: dollars(s.priceCents) })) : [{ name: "Small", price: "" }, { name: "Large", price: "" }]);

  const [comboOn, setComboOn] = useState(!!existingCombo);
  const [comboPrice, setComboPrice] = useState(existingCombo ? dollars(existingCombo.comboPriceCents) : "");
  const [comboWith, setComboWith] = useState(existingCombo?.comesWith || "fries & a drink");

  const [specialOn, setSpecialOn] = useState(hasSpecial);
  const [specialPrice, setSpecialPrice] = useState(item?.special_price_cents != null ? dollars(item.special_price_cents) : "");
  const [startTime, setStartTime] = useState(item?.special_price_start_time?.slice(0, 5) || "");
  const [endTime, setEndTime] = useState(item?.special_price_end_time?.slice(0, 5) || "");
  const [days, setDays] = useState<number[]>(item?.special_price_days || []);

  // Add-ons. While adding: chosen shared groups and new one-off groups, saved with the item.
  // While editing: attached and removed straight away.
  const [pickTemplates, setPickTemplates] = useState<string[]>([]);
  const [pendingGroups, setPendingGroups] = useState<PendingGroup[]>([]);
  const [groupForm, setGroupForm] = useState<PendingGroup | null>(null);
  const [addonBusy, setAddonBusy] = useState(false);

  const [copyOpen, setCopyOpen] = useState(false);
  const [copyTargets, setCopyTargets] = useState<string[]>([]);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !saving) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const sameNamed = useMemo(() => {
    const key = menuNameKey(name);
    return key ? items.find((i) => i.id !== item?.id && menuNameKey(i.name) === key) || null : null;
  }, [name, items, item?.id]);

  const attachedGroups = item ? item.modifier_groups.filter((g) => !isSizeGroup(g) && !isComboGroup(g)) : [];
  const attachedTemplateIds = new Set(attachedGroups.filter((g) => g.is_template).map((g) => g.id));
  const availableTemplates = addonTemplates.filter((t) => !attachedTemplateIds.has(t.id));

  function basePriceCents(): number | null {
    if (sizesOn) {
      const check = validateSizes(sizeRows);
      return check.ok && check.sizes.length ? Math.min(...check.sizes.map((s) => s.priceCents)) : null;
    }
    return toCents(price);
  }

  function validate(): string | null {
    if (!name.trim()) return "Give the item a name.";
    if (sameNamed) return `“${sameNamed.name}” is already on your menu.`;
    if (categoryId === NEW && !newCategory.trim()) return "Type a name for the new category, or pick one.";
    if (sizesOn) {
      const check = validateSizes(sizeRows);
      if (!check.ok) return check.error;
      if (check.sizes.length === 0) return "Add the sizes and their prices, or turn sizes off.";
    } else {
      const c = toCents(price);
      if (c === null || c < 0) return "Enter a price, like 7.99.";
    }
    if (comboOn) {
      const combo = toCents(comboPrice);
      const base = basePriceCents();
      if (combo === null || combo <= 0) return "Enter the combo price, like 14.99.";
      if (base !== null && combo <= base) return `The combo price has to be more than the item on its own (${money(base)}).`;
    }
    if (specialOn) {
      if (toCents(specialPrice) === null) return "Enter the special price.";
      if ((startTime && !endTime) || (!startTime && endTime)) return "Set both a start and end time for the special price, or leave both blank for all day.";
      if (!startTime && days.length === 0) return "Pick the days the special price applies, set a time window, or both.";
    }
    return null;
  }

  async function save() {
    const problem = validate();
    if (problem) { setError(problem); return; }
    setSaving(true);
    setError(null);
    const issues: string[] = [];
    let itemId = item?.id || null;
    let catId: string | null = categoryId && categoryId !== NEW ? categoryId : null;

    if (!isEdit) {
      const base = basePriceCents() ?? 0;
      const r = await addMenuItemAction({
        name: name.trim(),
        description,
        price: dollars(base),
        categoryId: categoryId === NEW ? null : catId,
        newCategoryName: categoryId === NEW ? newCategory : undefined,
        sizes: sizesOn ? sizeRows : undefined,
      });
      if (!r.success || !r.itemId) { setSaving(false); setError(r.error || "Couldn't add the item."); return; }
      itemId = r.itemId;
      for (const t of pickTemplates) {
        const a = await attachAddonTemplateAction(itemId, t);
        if (!a.success) issues.push(a.error || "an add-on didn't attach");
      }
      for (const g of pendingGroups) {
        const a = await addModifierGroupAction(itemId, { name: g.name, required: g.required, minSelect: g.required ? 1 : 0, maxSelect: 1, options: g.options });
        if (!a.success) issues.push(a.error || `the "${g.name}" add-on didn't save`);
      }
    } else {
      if (categoryId === NEW) {
        const c = await addMenuCategoryAction(newCategory);
        if (!c.success || !c.categoryId) { setSaving(false); setError(c.error || "Couldn't add that category."); return; }
        catId = c.categoryId;
      }
      const sizesChanged = sizesOn !== !!existingSizes || (sizesOn && JSON.stringify(sizeRows) !== JSON.stringify(existingSizes?.map((s) => ({ name: s.name, price: dollars(s.priceCents) }))));
      const basicsChanged = name.trim() !== item!.name || description !== (item!.description || "") || (catId || null) !== (item!.category_id || null) || (!sizesOn && toCents(price) !== item!.price_cents);
      if (basicsChanged) {
        const u = await updateMenuItemAction(item!.id, { name: name.trim(), description, price: sizesOn ? dollars(item!.price_cents) : price, categoryId: catId });
        if (!u.success) { setSaving(false); setError(u.error || "Couldn't save the item."); return; }
      }
      if (sizesChanged) {
        const s = await setItemSizesAction(item!.id, sizesOn ? sizeRows : []);
        if (!s.success) issues.push(s.error || "the sizes didn't save");
      }
    }

    // Combo after sizes and price: its add-on is the difference from the item's own price.
    // Re-saved too when the item's own price or sizes changed, so the combo
    // keeps the combo price shown here instead of moving with the price.
    const ownPriceChanged = isEdit && (sizesOn !== !!existingSizes || basePriceCents() !== item!.price_cents);
    const comboChanged = comboOn !== !!existingCombo || (comboOn && (ownPriceChanged || toCents(comboPrice) !== existingCombo?.comboPriceCents || comboWith.trim() !== (existingCombo?.comesWith || "")));
    if (itemId && (comboChanged || (!isEdit && comboOn))) {
      const c = await setItemComboAction(itemId, comboOn ? { comboPrice, comesWith: comboWith } : null);
      if (!c.success) issues.push(c.error || "the combo didn't save");
    }
    const specialChanged =
      specialOn !== hasSpecial ||
      (specialOn && (toCents(specialPrice) !== item?.special_price_cents || startTime !== (item?.special_price_start_time?.slice(0, 5) || "") || endTime !== (item?.special_price_end_time?.slice(0, 5) || "") || JSON.stringify(days) !== JSON.stringify(item?.special_price_days || [])));
    if (itemId && specialChanged) {
      const t = await updateMenuItemTimePricingAction(itemId, specialOn ? { specialPrice, startTime, endTime, days } : { specialPrice: "", startTime: "", endTime: "", days: [] });
      if (!t.success) issues.push(t.error || "the special price didn't save");
    }

    setSaving(false);
    onRefresh();
    if (issues.length) {
      onSaved(`${isEdit ? "Saved" : `Added “${name.trim()}”`}, but ${issues.join("; ")}.`, "error");
    } else {
      onSaved(isEdit ? `Saved “${name.trim()}”.` : `Added “${name.trim()}” to your menu.`);
    }
    onClose();
  }

  function attachNow(templateId: string) {
    if (!item) { setPickTemplates((p) => (p.includes(templateId) ? p.filter((x) => x !== templateId) : [...p, templateId])); return; }
    setAddonBusy(true);
    startTransition(async () => { await attachAddonTemplateAction(item.id, templateId); setAddonBusy(false); onRefresh(); });
  }
  function removeGroupNow(groupId: string, isTemplate: boolean) {
    if (!item) return;
    setAddonBusy(true);
    startTransition(async () => {
      if (isTemplate) await detachAddonTemplateAction(item.id, groupId);
      else await deleteModifierGroupAction(groupId);
      setAddonBusy(false);
      onRefresh();
    });
  }
  function saveGroupForm() {
    if (!groupForm) return;
    if (!groupForm.name.trim()) { setError("Give the add-on group a name, like Toppings."); return; }
    const options = groupForm.options.filter((o) => o.name.trim());
    if (options.length === 0) { setError("Add at least one option to the group."); return; }
    setError(null);
    const g = { ...groupForm, options };
    if (!item) { setPendingGroups((p) => [...p, g]); setGroupForm(null); return; }
    setAddonBusy(true);
    startTransition(async () => {
      const r = await addModifierGroupAction(item.id, { name: g.name, required: g.required, minSelect: g.required ? 1 : 0, maxSelect: 1, options: g.options });
      setAddonBusy(false);
      if (!r.success) { setError(r.error || "Couldn't save the add-on group."); return; }
      setGroupForm(null);
      onRefresh();
    });
  }
  function copySizes() {
    if (!item || copyTargets.length === 0) return;
    setAddonBusy(true);
    startTransition(async () => {
      const r = await copyItemSizesAction(item.id, copyTargets);
      setAddonBusy(false);
      if (!r.success) { setError(r.error || "Couldn't copy the sizes."); return; }
      setCopyOpen(false);
      setCopyTargets([]);
      onSaved(`Copied the sizes to ${r.copied ?? copyTargets.length} item${(r.copied ?? copyTargets.length) === 1 ? "" : "s"}.`);
      onRefresh();
    });
  }
  function deleteItem() {
    if (!item) return;
    setSaving(true);
    startTransition(async () => {
      const r = await deleteMenuItemAction(item.id);
      setSaving(false);
      if (!r.success) { setError(r.error || "Couldn't delete the item."); return; }
      onSaved(`Deleted “${item.name}”.`);
      onDeleted(item.id);
    });
  }

  const base = basePriceCents();
  const comboCents = toCents(comboPrice);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={isEdit ? `Edit ${item!.name}` : "Add a menu item"}>
      <button type="button" className="absolute inset-0 bg-ink/40" aria-label="Close" onClick={() => !saving && onClose()} />
      <div className="relative flex h-full w-full max-w-[560px] flex-col bg-card shadow-2xl" style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <h2 className="min-w-0 flex-1 truncate font-display text-[17px] font-semibold text-ink">{isEdit ? item!.name : "Add a menu item"}</h2>
          {isEdit && (
            <label className="flex items-center gap-2 text-[12.5px] font-medium text-text-muted">
              <Switch checked={item!.is_active} onCheckedChange={(v) => onToggle(item!.id, v)} aria-label="Available to order" />
              {item!.is_active ? "Available" : "Off"}
            </label>
          )}
          <button type="button" onClick={onClose} disabled={saving} className="rounded-md p-1.5 text-text-faint hover:bg-paper hover:text-ink" aria-label="Close"><X className="h-4.5 w-4.5" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {error && <div role="alert" className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{error}</div>}

          <div className="grid grid-cols-[minmax(0,1fr)_130px] gap-3">
            <div>
              <Label htmlFor="item-name" className="text-[12px] text-text-muted">Name</Label>
              <Input id="item-name" className={`mt-1 ${sameNamed ? "border-amber-400" : ""}`} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cheeseburger" autoFocus={!isEdit} />
              {sameNamed && <p className="mt-1 text-[12px] text-amber-700">&ldquo;{sameNamed.name}&rdquo; is already on your menu.</p>}
            </div>
            <div>
              <Label htmlFor="item-price" className="text-[12px] text-text-muted">{comboOn ? "Price on its own" : "Price"}</Label>
              {sizesOn ? (
                <div className="mt-1 flex h-10 items-center rounded-lg border border-dashed border-border px-3 text-[12px] text-text-faint">Set by sizes</div>
              ) : (
                <div className="relative mt-1">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-text-faint">$</span>
                  <Input id="item-price" inputMode="decimal" className="pl-6" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="7.99" />
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-[12px] font-medium text-text-muted">Category</div>
            <CategoryPicker categories={categories} value={categoryId} onChange={setCategoryId} newName={newCategory} onNewName={setNewCategory} />
          </div>

          <div>
            <Label htmlFor="item-description" className="text-[12px] text-text-muted">What comes on it <span className="text-text-faint">(optional, your AI uses this for allergy questions)</span></Label>
            <Input id="item-description" className="mt-1" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. American cheese, lettuce, tomato, pickles" />
          </div>

          <OptionSection id="opt-combo" title="Sold as a combo" hint="Your AI offers it when this item is ordered." on={comboOn} onToggle={setComboOn}>
            {comboOn && (
              <div className="grid grid-cols-[130px_minmax(0,1fr)] gap-3">
                <div>
                  <Label htmlFor="combo-price" className="text-[12px] text-text-muted">Combo price</Label>
                  <div className="relative mt-1">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-text-faint">$</span>
                    <Input id="combo-price" inputMode="decimal" className="bg-card pl-6" value={comboPrice} onChange={(e) => setComboPrice(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="14.99" />
                  </div>
                </div>
                <div>
                  <Label htmlFor="combo-with" className="text-[12px] text-text-muted">Comes with</Label>
                  <Input id="combo-with" className="mt-1 bg-card" value={comboWith} onChange={(e) => setComboWith(e.target.value)} placeholder="fries & a drink" />
                </div>
                {base !== null && comboCents !== null && comboCents > base && (
                  <p className="col-span-2 text-[12px] text-text-muted">
                    On its own {money(base)} · as a combo {money(comboCents)} (adds {money(comboCents - base)}){sizesOn ? ". Bigger sizes add the same amount." : ""}
                  </p>
                )}
              </div>
            )}
          </OptionSection>

          <OptionSection id="opt-sizes" title="Comes in sizes" hint="Small, large… each with its own price." on={sizesOn} onToggle={(v) => { setSizesOn(v); if (v && price && !sizeRows.some((r) => r.price)) setSizeRows((rows) => rows.map((r, i) => (i === 0 ? { ...r, price } : r))); }}>
            {sizesOn && (
              <div>
                <SizesEditor rows={sizeRows} onChange={setSizeRows} />
                {isEdit && existingSizes && (
                  <div className="mt-3">
                    {!copyOpen ? (
                      <Button size="sm" variant="outline" onClick={() => setCopyOpen(true)}><CopyIcon className="h-3.5 w-3.5" /> Copy these sizes to other items</Button>
                    ) : (
                      <div className="rounded-lg border border-border bg-card p-2">
                        <div className="max-h-44 space-y-0.5 overflow-y-auto">
                          {items.filter((i) => i.id !== item!.id).map((c) => (
                            <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] hover:bg-paper">
                              <input type="checkbox" className="h-3.5 w-3.5 accent-[#2563EB]" checked={copyTargets.includes(c.id)} onChange={(e) => setCopyTargets((t) => (e.target.checked ? [...t, c.id] : t.filter((x) => x !== c.id)))} />
                              <span className="flex-1 truncate text-text">{c.name}</span>
                            </label>
                          ))}
                        </div>
                        <div className="mt-2 flex gap-2">
                          <Button size="sm" variant="brand" onClick={copySizes} disabled={addonBusy || copyTargets.length === 0}>Copy to {copyTargets.length || ""} item{copyTargets.length === 1 ? "" : "s"}</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setCopyOpen(false); setCopyTargets([]); }}>Cancel</Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </OptionSection>

          <OptionSection
            id="opt-addons"
            title="Add-ons"
            hint="Toppings, cheese, bread… your AI offers these on this item."
            on={attachedGroups.length + pickTemplates.length + pendingGroups.length > 0}
            action={!groupForm ? <Button size="sm" variant="outline" className="border-dashed text-brand" onClick={() => setGroupForm({ name: "", required: false, options: [{ name: "", priceDelta: "" }] })}><Plus className="h-3.5 w-3.5" /> New group</Button> : undefined}
          >
            <div className="space-y-2">
              {attachedGroups.map((g) => (
                <div key={g.id} className="flex items-center justify-between gap-2 rounded-lg bg-card px-3 py-2 text-[12.5px] ring-1 ring-border">
                  <span className="min-w-0 text-text">
                    <span className="font-semibold">{g.name}</span>
                    {g.is_template && <span className="ml-1.5 rounded-full bg-brand-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-brand-dark">Shared</span>}
                    <span className="text-text-muted"> · {g.modifiers.map((m) => m.name).slice(0, 4).join(", ")}{g.modifiers.length > 4 ? ` +${g.modifiers.length - 4}` : ""}</span>
                  </span>
                  <button type="button" disabled={addonBusy} onClick={() => removeGroupNow(g.id, !!g.is_template)} className="shrink-0 rounded-md p-1 text-text-faint hover:bg-danger-soft hover:text-danger" aria-label={g.is_template ? `Remove ${g.name} from this item` : `Delete ${g.name}`}>
                    {g.is_template ? <Unlink className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </div>
              ))}
              {pendingGroups.map((g, i) => (
                <div key={`p${i}`} className="flex items-center justify-between gap-2 rounded-lg bg-card px-3 py-2 text-[12.5px] ring-1 ring-border">
                  <span className="text-text"><span className="font-semibold">{g.name}</span><span className="text-text-muted"> · {g.options.map((o) => o.name).join(", ")}</span></span>
                  <button type="button" onClick={() => setPendingGroups((p) => p.filter((_, j) => j !== i))} className="rounded-md p-1 text-text-faint hover:bg-danger-soft hover:text-danger" aria-label={`Remove ${g.name}`}><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
              {availableTemplates.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[11.5px] font-medium text-text-muted">From your add-ons library (tap to {isEdit ? "add" : "choose"})</div>
                  <div className="flex flex-wrap gap-1.5">
                    {availableTemplates.map((t) => {
                      const on = pickTemplates.includes(t.id);
                      return (
                        <button key={t.id} type="button" disabled={addonBusy} onClick={() => attachNow(t.id)} aria-pressed={on}
                          className={`rounded-full border px-3 py-1 text-[12.5px] font-medium ${on ? "border-brand bg-brand-soft text-brand-dark" : "border-border bg-card text-text hover:border-brand/40"}`}>
                          {on ? "✓ " : "+ "}{t.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {groupForm && (
                <div className="rounded-lg border border-border bg-card p-3">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                    <Input id="addon-group-name" placeholder="Group name, e.g. Toppings" value={groupForm.name} onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })} />
                    <label className="flex items-center gap-2 text-[12.5px] text-text-muted"><Switch checked={groupForm.required} onCheckedChange={(v) => setGroupForm({ ...groupForm, required: v })} /> Must pick one</label>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {groupForm.options.map((o, i) => (
                      <div key={i} className="flex gap-2">
                        <Input placeholder="Option, e.g. Bacon" value={o.name} onChange={(e) => setGroupForm({ ...groupForm, options: groupForm.options.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                        <Input placeholder="+$ (or -1.50)" className="w-32" value={o.priceDelta} onChange={(e) => setGroupForm({ ...groupForm, options: groupForm.options.map((x, j) => (j === i ? { ...x, priceDelta: e.target.value } : x)) })} />
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setGroupForm({ ...groupForm, options: [...groupForm.options, { name: "", priceDelta: "" }] })}><Plus className="h-3.5 w-3.5" /> Another option</Button>
                    <Button size="sm" variant="brand" onClick={saveGroupForm} disabled={addonBusy}>{isEdit ? "Save group" : "Add group"}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setGroupForm(null)}>Cancel</Button>
                  </div>
                  <p className="mt-2 text-[11.5px] text-text-faint">A negative price lowers the item&apos;s price, like &ldquo;No drink -1.50&rdquo;.</p>
                </div>
              )}
              {attachedGroups.length + pendingGroups.length === 0 && availableTemplates.length === 0 && !groupForm && (
                <p className="text-[12px] text-text-faint">No add-ons yet. Use New group, or build reusable ones in the Add-ons tab.</p>
              )}
            </div>
          </OptionSection>

          <OptionSection id="opt-special" title="Special price" hint="Cheaper on certain days or at certain times, like a breakfast special." on={specialOn} onToggle={setSpecialOn}>
            {specialOn && (
              <div className="space-y-3">
                <div>
                  <div className="mb-1 text-[12px] text-text-muted">Days (none picked = every day)</div>
                  <DayPicker value={days} onChange={setDays} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label htmlFor="special-price" className="text-[12px] text-text-muted">Special price</Label>
                    <Input id="special-price" className="mt-1 bg-card" inputMode="decimal" placeholder="5.99" value={specialPrice} onChange={(e) => setSpecialPrice(e.target.value.replace(/[^0-9.]/g, ""))} />
                  </div>
                  <div>
                    <Label htmlFor="special-start" className="text-[12px] text-text-muted">From</Label>
                    <Input id="special-start" className="mt-1 bg-card" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="special-end" className="text-[12px] text-text-muted">Until</Label>
                    <Input id="special-end" className="mt-1 bg-card" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                  </div>
                </div>
                <p className="text-[11.5px] text-text-faint">Leave the times blank for all day. Any other time, the regular price applies.</p>
              </div>
            )}
          </OptionSection>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3.5">
          {isEdit && (confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-[12.5px] text-danger">Delete this item?</span>
              <Button size="sm" variant="outline" className="border-danger/30 text-danger hover:bg-danger-soft" onClick={deleteItem} disabled={saving}>Yes, delete</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>No</Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-soft" onClick={() => setConfirmDelete(true)}><Trash2 className="h-3.5 w-3.5" /> Delete item</Button>
          ))}
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button variant="brand" onClick={save} disabled={saving || !!sameNamed}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {isEdit ? "Save changes" : "Add item"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
