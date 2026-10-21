"use client";
import { useState, useTransition, useRef, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Unlink, Globe, Camera, ClipboardPaste, Loader2, UtensilsCrossed, ChevronDown, ChevronUp, CheckCircle2, Search, Tags, Pencil, Clock, X, Percent, FileText, FileSpreadsheet, Upload, Copy as CopyIcon, AlertTriangle } from "lucide-react";
import type { DbMenuCategory, MenuItemWithModifiers } from "@/lib/database/types";
import type { AddonTemplate } from "@/lib/data/menu";
import { EASY_TO_MISS_HIGHLIGHT, EASY_TO_MISS_INPUT_HIGHLIGHT } from "@/lib/ui/highlight";
import { describeTimePricing } from "@/lib/business/pricing";
import { DayPicker } from "@/components/dashboard/day-picker";
import {
  addMenuItemAction, updateMenuItemAction, deleteMenuItemAction, toggleMenuItemActiveAction,
  addModifierGroupAction, deleteModifierGroupAction,
  createAddonTemplateAction, renameAddonTemplateAction, addAddonTemplateOptionAction, deleteAddonOptionAction, deleteAddonTemplateAction,
  attachAddonTemplateAction, detachAddonTemplateAction,
  updateMenuItemTimePricingAction, setItemSizesAction, copyItemSizesAction, removeDuplicateItemsAction,
  extractMenuFromWebsiteAction, extractMenuFromTextAction, extractMenuFromImageAction, extractMenuFromPdfAction, importMenuItemsAction,
} from "@/app/actions/menu";
import type { ExtractedMenuItem } from "@/lib/ai/websiteImport";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PromotionsPanel } from "@/components/dashboard/promotions-panel";
import { SizesEditor, type SizeRow } from "@/components/dashboard/sizes-editor";
import { readSizes, priceRangeText, isSizeGroup, validateSizes } from "@/lib/menu/sizes";
import { parseMenuCsv } from "@/lib/menu/csvImport";
import { dedupeImportItems, menuNameKey } from "@/lib/menu/importDedupe";

const UNCATEGORIZED = "__uncategorized__";
const ALL = "__all__";
const NEW_CATEGORY = "__new__";

export function MenuClient({
  initialCategories,
  initialItems,
  initialAddonTemplates,
  initialTab,
  promotions,
}: {
  initialCategories: DbMenuCategory[];
  initialItems: MenuItemWithModifiers[];
  initialAddonTemplates: AddonTemplate[];
  initialTab?: string;
  promotions?: React.ComponentProps<typeof PromotionsPanel>;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [categories, setCategories] = useState(initialCategories);
  const [addonTemplates, setAddonTemplates] = useState(initialAddonTemplates);
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState("");

  // router.refresh() re-fetches this page's server data and passes new
  // initial* props down, but a mounted client component's useState
  // keeps its OLD value across that — React only reads the initial
  // value once, on first mount. Without this, anything added via
  // router.refresh() alone (a new add-on template was the one actually
  // reported broken, but the same gap existed for new items/categories
  // too) would silently not show up until a full page reload. Syncing
  // on every prop change fixes all three at once.
  useEffect(() => { setItems(initialItems); }, [initialItems]);
  useEffect(() => { setCategories(initialCategories); }, [initialCategories]);
  useEffect(() => { setAddonTemplates(initialAddonTemplates); }, [initialAddonTemplates]);

  // Add item form
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  // "" = uncategorized, NEW_CATEGORY = type a new one, otherwise a category id.
  const [categoryChoice, setCategoryChoice] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [hasSizes, setHasSizes] = useState(false);
  const [sizeRows, setSizeRows] = useState<SizeRow[]>([{ name: "Small", price: "" }, { name: "Large", price: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  // Which category tab the list on the right shows.
  const [activeCategory, setActiveCategory] = useState<string>(ALL);

  function refresh() {
    router.refresh();
  }

  // The menu never holds the same item twice (see lib/menu/importDedupe.ts).
  const sameNamedItem = useMemo(() => {
    const key = menuNameKey(name);
    return key ? items.find((i) => menuNameKey(i.name) === key) || null : null;
  }, [name, items]);

  // Copies already on the menu from before duplicates were blocked.
  const duplicateGroups = useMemo(() => {
    const byKey = new Map<string, MenuItemWithModifiers[]>();
    for (const i of items) {
      const key = menuNameKey(i.name);
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(i);
    }
    return Array.from(byKey.values()).filter((g) => g.length > 1);
  }, [items]);
  const [showDuplicates, setShowDuplicates] = useState(false);

  // Items with no price (often $0.00 rows from a POS export). The AI won't
  // sell them over the phone until a price (or sizes) is set.
  const unpricedCount = useMemo(() => items.filter((i) => i.is_active && i.price_cents === 0 && !readSizes(i) && !i.special_price_cents).length, [items]);
  const [onlyUnpriced, setOnlyUnpriced] = useState(false);

  function addItem() {
    if (!name.trim()) { setError("Give the item a name."); return; }
    if (sameNamedItem) { setError(`"${sameNamedItem.name}" is already on your menu. Edit that item instead of adding it again.`); return; }
    let sizes: SizeRow[] = [];
    let itemPrice = price;
    if (hasSizes) {
      const check = validateSizes(sizeRows);
      if (!check.ok) { setError(check.error); return; }
      if (check.sizes.length === 0) { setError("Add the sizes and their prices, or turn sizes off."); return; }
      sizes = sizeRows;
      itemPrice = (Math.min(...check.sizes.map((s) => s.priceCents)) / 100).toFixed(2);
    } else if (!price.trim()) { setError("Enter a price."); return; }
    setSaving(true);
    setError(null);
    startTransition(async () => {
      const isNew = categoryChoice === NEW_CATEGORY;
      if (isNew && !newCategory.trim()) { setSaving(false); setError("Type a name for the new category, or pick an existing one."); return; }
      const result = await addMenuItemAction({
        name,
        description,
        price: itemPrice,
        categoryId: isNew || !categoryChoice ? null : categoryChoice,
        newCategoryName: isNew ? newCategory : undefined,
        sizes: hasSizes ? sizes : undefined,
      });
      setSaving(false);
      if (!result.success) { setError(result.error || "Could not add item."); return; }
      setJustAdded(name.trim());
      setName(""); setDescription(""); setPrice("");
      setHasSizes(false); setSizeRows([{ name: "Small", price: "" }, { name: "Large", price: "" }]);
      if (isNew) { setNewCategory(""); setCategoryChoice(""); }
      refresh();
    });
  }

  function toggleActive(itemId: string, isActive: boolean) {
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, is_active: isActive } : i)));
    startTransition(async () => { await toggleMenuItemActiveAction(itemId, isActive); });
  }

  function removeItem(itemId: string) {
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    startTransition(async () => { await deleteMenuItemAction(itemId); });
  }

  // Group items by category, like a real printed menu, filtered by search.
  const groupedItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matching = q
      ? items.filter((i) => i.name.toLowerCase().includes(q) || (i.description || "").toLowerCase().includes(q))
      : items;
    const visible = onlyUnpriced ? matching.filter((i) => i.price_cents === 0 && !readSizes(i) && !i.special_price_cents) : matching;

    const byCategory = new Map<string, MenuItemWithModifiers[]>();
    for (const item of visible) {
      const key = item.category_id || UNCATEGORIZED;
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key)!.push(item);
    }

    const groups: { key: string; name: string; items: MenuItemWithModifiers[] }[] = [];
    for (const cat of categories) {
      const catItems = byCategory.get(cat.id);
      if (catItems && catItems.length > 0) groups.push({ key: cat.id, name: cat.name, items: catItems });
    }
    const uncategorized = byCategory.get(UNCATEGORIZED);
    if (uncategorized && uncategorized.length > 0) groups.push({ key: UNCATEGORIZED, name: "Uncategorized", items: uncategorized });
    return groups;
  }, [items, categories, search, onlyUnpriced]);

  const totalVisible = groupedItems.reduce((sum, g) => sum + g.items.length, 0);
  const searching = search.trim().length > 0 || onlyUnpriced;

  // One tab per category that has items, with counts (unaffected by search).
  const categoryTabs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const key = item.category_id || UNCATEGORIZED;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const tabs = categories.filter((c) => counts.has(c.id)).map((c) => ({ key: c.id, name: c.name, count: counts.get(c.id)! }));
    if (counts.has(UNCATEGORIZED)) tabs.push({ key: UNCATEGORIZED, name: "Uncategorized", count: counts.get(UNCATEGORIZED)! });
    return tabs;
  }, [items, categories]);

  // A tab whose category emptied out falls back to All.
  const currentTab = activeCategory === ALL || categoryTabs.some((t) => t.key === activeCategory) ? activeCategory : ALL;
  // While searching, show matches from every category; otherwise only the chosen tab.
  const shownGroups = searching || currentTab === ALL ? groupedItems : groupedItems.filter((g) => g.key === currentTab);

  return (
    <Tabs defaultValue={initialTab ?? "items"}>
      <TabsList className="flex-wrap">
        <TabsTrigger value="items">Menu items</TabsTrigger>
        <TabsTrigger value="addons"><Tags className="h-3.5 w-3.5" /> Add-ons</TabsTrigger>
        {promotions && <TabsTrigger value="promotions"><Percent className="h-3.5 w-3.5" /> Promotions</TabsTrigger>}
        <TabsTrigger value="import"><Globe className="h-3.5 w-3.5" /> Import</TabsTrigger>
      </TabsList>

      <TabsContent value="items">
        {/* Add an item: always first, full width, compact. */}
        <Card className="mb-4">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-soft text-brand-dark"><Plus className="h-4 w-4" /></span>
              <h2 className="font-display text-[15px] font-semibold text-ink">Add a menu item</h2>
              <span className="hidden text-[12px] text-text-faint sm:inline">Your AI only offers items and prices listed here.</span>
            </div>
            {error && <div className="mt-3 rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{error}</div>}
            {justAdded && !error && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-success/20 bg-success-soft px-3.5 py-2.5 text-[12.5px] text-success">
                <CheckCircle2 className="h-4 w-4" /> Added &ldquo;{justAdded}&rdquo; to your menu.
              </div>
            )}
            <div className="mt-3 grid gap-3 md:grid-cols-[2fr,1fr,1.4fr,auto] md:items-start">
              <div>
                <Label className="text-[12px] text-text-muted">Name</Label>
                <Input className={`mt-1 ${sameNamedItem ? "border-amber-400" : ""}`} value={name} onChange={(e) => { setName(e.target.value); setJustAdded(null); setError(null); }} onKeyDown={(e) => { if (e.key === "Enter" && !saving) addItem(); }} placeholder="e.g. French Fries" />
                {sameNamedItem && <p className="mt-1 text-[12px] text-amber-700">&ldquo;{sameNamedItem.name}&rdquo; is already on your menu.</p>}
              </div>
              <div>
                <Label className="text-[12px] text-text-muted">Price ($)</Label>
                {hasSizes
                  ? <div className="mt-1 flex h-10 items-center rounded-lg border border-dashed border-border px-3 text-[12.5px] text-text-faint">Set by sizes below</div>
                  : <Input type="number" step="0.01" min="0" className="mt-1" value={price} onChange={(e) => setPrice(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !saving) addItem(); }} placeholder="0.00" />}
              </div>
              <div>
                <Label className="text-[12px] text-text-muted">Category</Label>
                <select
                  className="mt-1 h-10 w-full rounded-lg border border-border bg-card px-3 text-[13.5px] text-text"
                  value={categoryChoice}
                  onChange={(e) => setCategoryChoice(e.target.value)}
                >
                  <option value="">No category</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  <option value={NEW_CATEGORY}>+ New category…</option>
                </select>
                {categoryChoice === NEW_CATEGORY && (
                  <Input className="mt-2" autoFocus value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="New category name, e.g. Desserts" />
                )}
              </div>
              <div className="hidden md:block md:pt-[28px]">
                <Button variant="brand" className="h-10" onClick={addItem} disabled={saving || !!sameNamedItem}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add item
                </Button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
              <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-text">
                <Switch checked={hasSizes} onCheckedChange={(v) => { setHasSizes(v); setError(null); if (v && price.trim() && !sizeRows.some((r) => r.price)) setSizeRows((rows) => rows.map((r, i) => (i === 0 ? { ...r, price } : r))); }} />
                Comes in sizes <span className="font-normal text-text-faint">(small, large…)</span>
              </label>
              <Input className="h-9 min-w-[220px] flex-1" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional): what comes on it" aria-label="Description" />
            </div>
            {hasSizes && <div className="mt-3 max-w-xl rounded-lg border border-border bg-paper p-3"><SizesEditor rows={sizeRows} onChange={setSizeRows} /></div>}
            {/* On a phone the button comes last, after every field. */}
            <Button variant="brand" className="mt-3 w-full md:hidden" onClick={addItem} disabled={saving || !!sameNamedItem}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add item
            </Button>
          </CardContent>
        </Card>

        {unpricedCount > 0 && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
            <span className="flex items-center gap-2 text-[13px] font-medium text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {unpricedCount} item{unpricedCount === 1 ? " has" : "s have"} no price, so your AI won&apos;t sell {unpricedCount === 1 ? "it" : "them"} over the phone. Add a price or sizes.
            </span>
            <Button size="sm" variant="outline" onClick={() => { setOnlyUnpriced((v) => !v); setSearch(""); }}>{onlyUnpriced ? "Show all items" : "Show them"}</Button>
          </div>
        )}
        {duplicateGroups.length > 0 && (
          <div className="mb-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
              <span className="flex items-center gap-2 text-[13px] font-medium text-amber-800">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {duplicateGroups.length} item{duplicateGroups.length === 1 ? " is" : "s are"} on your menu more than once. Your AI could quote the wrong one.
              </span>
              <Button size="sm" variant="outline" onClick={() => setShowDuplicates((v) => !v)}>{showDuplicates ? "Hide" : "Fix duplicates"}</Button>
            </div>
            {showDuplicates && <DuplicatesPanel groups={duplicateGroups} categories={categories} onFixed={(removedIds) => { setItems((prev) => prev.filter((i) => !removedIds.includes(i.id))); refresh(); }} />}
          </div>
        )}
        <div>
          {/* The menu, one category at a time. */}
          <div className="min-w-0">
            <Card>
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search the menu…"
                      className="h-10 w-full rounded-lg border border-border bg-paper pl-8 pr-8 text-[13px] focus:border-brand focus:outline-none"
                    />
                    {searching && (
                      <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-faint hover:text-ink" aria-label="Clear search"><X className="h-3.5 w-3.5" /></button>
                    )}
                  </div>
                </div>

                {items.length > 0 && (
                  <div role="tablist" aria-label="Menu categories" className={`mt-3 flex flex-wrap gap-1.5 ${searching ? "opacity-50" : ""}`}>
                    {[{ key: ALL, name: "All", count: items.length }, ...categoryTabs].map((t) => {
                      const selected = !searching && t.key === currentTab;
                      return (
                        <button
                          key={t.key}
                          role="tab"
                          aria-selected={selected}
                          onClick={() => { setActiveCategory(t.key); setSearch(""); }}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors ${
                            selected ? "border-brand bg-brand text-white shadow-sm" : "border-border bg-card text-text-muted hover:border-brand/40 hover:text-ink"
                          }`}
                        >
                          {t.name}
                          <span className={`rounded-full px-1.5 text-[11px] ${selected ? "bg-white/20 text-white" : "bg-paper text-text-faint"}`}>{t.count}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="mt-4 border-t border-border pt-4">
                  {items.length === 0 ? (
                    <EmptyState icon={UtensilsCrossed} title="No menu items yet" description="Add your first item, or import your whole menu from a website or photo in the Import tab." />
                  ) : totalVisible === 0 ? (
                    <p className="py-8 text-center text-[13px] text-text-muted">No items match &ldquo;{search}&rdquo;.</p>
                  ) : (
                    <div className="space-y-6">
                      {searching && <p className="text-[12px] text-text-faint">{totalVisible} match{totalVisible === 1 ? "" : "es"} across all categories</p>}
                      {shownGroups.map((group) => (
                        <div key={group.key}>
                          {(searching || currentTab === ALL) && (
                            <h3 className="mb-2 flex items-center gap-2 font-display text-[13px] font-semibold uppercase tracking-wide text-text-muted">
                              {group.name}<span className="text-[11px] font-normal normal-case text-text-faint">{group.items.length}</span>
                            </h3>
                          )}
                          <div className="space-y-2.5">
                            {group.items.map((item) => (
                              <MenuItemRow
                                key={item.id}
                                item={item}
                                addonTemplates={addonTemplates}
                                allItems={items}
                                categories={categories}
                                onToggle={toggleActive}
                                onRemove={removeItem}
                                onRefresh={refresh}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="addons">
        <AddonLibraryPanel templates={addonTemplates} setTemplates={setAddonTemplates} onRefresh={refresh} items={items} />
      </TabsContent>

      {promotions && (
        <TabsContent value="promotions">
          <PromotionsPanel {...promotions} />
        </TabsContent>
      )}

      <TabsContent value="import">
        <MenuImportPanel onImported={refresh} existingNames={items.map((i) => i.name)} />
      </TabsContent>
    </Tabs>
  );
}

/**
 * One card per item that's on the menu more than once. The suggested copy
 * to keep is the one most likely to be "the real one": switched on, with
 * add-ons or sizes, with a price. The owner can pick another.
 */
function DuplicatesPanel({ groups, categories, onFixed }: {
  groups: MenuItemWithModifiers[][];
  categories: DbMenuCategory[];
  onFixed: (removedIds: string[]) => void;
}) {
  const [, startTransition] = useTransition();
  const suggest = (g: MenuItemWithModifiers[]) =>
    [...g].sort((a, b) => Number(b.is_active) - Number(a.is_active) || b.modifier_groups.length - a.modifier_groups.length || Number(b.price_cents > 0) - Number(a.price_cents > 0) || b.price_cents - a.price_cents)[0].id;
  const [keep, setKeep] = useState<Record<string, string>>(() => Object.fromEntries(groups.map((g) => [g[0].id, suggest(g)])));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name || "No category";

  async function fix(group: MenuItemWithModifiers[]) {
    const keepId = keep[group[0].id] || suggest(group);
    const removeIds = group.map((i) => i.id).filter((id) => id !== keepId);
    const result = await removeDuplicateItemsAction(keepId, removeIds);
    if (!result.success) throw new Error(result.error || "Could not remove the copies.");
    return removeIds;
  }

  function fixOne(group: MenuItemWithModifiers[]) {
    setBusy(group[0].id);
    setError(null);
    startTransition(async () => {
      try { onFixed(await fix(group)); } catch (err) { setError(err instanceof Error ? err.message : "Could not remove the copies."); }
      setBusy(null);
    });
  }

  function fixAll() {
    setBusy("all");
    setError(null);
    startTransition(async () => {
      const removed: string[] = [];
      try {
        for (const g of groups) removed.push(...(await fix(g)));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not remove the copies.");
      }
      onFixed(removed);
      setBusy(null);
    });
  }

  return (
    <Card className="mt-3">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><CopyIcon className="h-4 w-4 text-brand-dark" /> Remove duplicate items</CardTitle>
            <CardDescription className="mt-1">Pick the copy to keep. The others are deleted. Past orders keep their item names.</CardDescription>
          </div>
          <Button size="sm" variant="brand" onClick={fixAll} disabled={busy !== null}>{busy === "all" ? "Removing…" : "Keep the suggested ones and remove the rest"}</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <div className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div>}
        {groups.map((g) => (
          <div key={g[0].id} className="rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[13.5px] font-semibold text-ink">{g[0].name} <span className="font-normal text-text-faint">× {g.length}</span></div>
              <Button size="sm" variant="outline" onClick={() => fixOne(g)} disabled={busy !== null}>{busy === g[0].id ? "Removing…" : `Keep one, remove ${g.length - 1}`}</Button>
            </div>
            <div className="mt-2 space-y-1">
              {g.map((i) => {
                const sizes = readSizes(i);
                const addons = i.modifier_groups.filter((m) => !isSizeGroup(m)).length;
                return (
                  <label key={i.id} className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-1.5 text-[12.5px] hover:bg-paper">
                    <input type="radio" name={`keep-${g[0].id}`} className="accent-[#2563EB]" checked={(keep[g[0].id] || suggest(g)) === i.id} onChange={() => setKeep((k) => ({ ...k, [g[0].id]: i.id }))} />
                    <span className="font-medium text-ink">{i.name}</span>
                    <span className="tabular-nums text-text">{priceRangeText(i.price_cents, sizes)}</span>
                    <span className="text-text-muted">{catName(i.category_id)}</span>
                    {sizes && <span className="rounded-full bg-brand-soft px-1.5 py-0.5 text-[10.5px] font-medium text-brand-dark">{sizes.length} sizes</span>}
                    {addons > 0 && <span className="rounded-full bg-paper px-1.5 py-0.5 text-[10.5px] text-text-faint">{addons} add-on{addons === 1 ? "" : "s"}</span>}
                    {!i.is_active && <span className="rounded-full bg-border-soft px-1.5 py-0.5 text-[10.5px] text-text-muted">Off</span>}
                    {i.id === suggest(g) && <span className="text-[11px] text-success">Suggested</span>}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function MenuItemRow({ item, addonTemplates, allItems, categories, onToggle, onRemove, onRefresh }: {
  item: MenuItemWithModifiers;
  addonTemplates: AddonTemplate[];
  allItems: MenuItemWithModifiers[];
  categories: DbMenuCategory[];
  onToggle: (id: string, active: boolean) => void;
  onRemove: (id: string) => void;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [, startTransition] = useTransition();

  // Name, price, description and category of an existing item.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: item.name, price: (item.price_cents / 100).toFixed(2), description: item.description || "", categoryId: item.category_id || "" });
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const sameNamedOther = useMemo(() => {
    const key = menuNameKey(draft.name);
    return key ? allItems.find((i) => i.id !== item.id && menuNameKey(i.name) === key) || null : null;
  }, [draft.name, allItems, item.id]);

  function saveEdit() {
    if (!draft.name.trim()) { setEditError("Give the item a name."); return; }
    if (sameNamedOther) { setEditError(`"${sameNamedOther.name}" is already on your menu.`); return; }
    const priceNum = parseFloat(draft.price);
    if (!sizesNow && (!Number.isFinite(priceNum) || priceNum < 0)) { setEditError("Enter a price, like 8.49."); return; }
    setSavingEdit(true);
    setEditError(null);
    startTransition(async () => {
      const result = await updateMenuItemAction(item.id, { name: draft.name.trim(), description: draft.description, price: sizesNow ? (item.price_cents / 100).toFixed(2) : draft.price, categoryId: draft.categoryId || null });
      setSavingEdit(false);
      if (!result.success) { setEditError(result.error || "Could not save."); return; }
      setEditing(false);
      onRefresh();
    });
  }
  const sizesNow = readSizes(item);

  // Sizes (stored as the item's required "Size" choice; see lib/menu/sizes.ts)
  const sizes = readSizes(item);
  const otherGroups = item.modifier_groups.filter((g) => !isSizeGroup(g));
  const toRows = () => (sizes ? sizes.map((s) => ({ name: s.name, price: (s.priceCents / 100).toFixed(2) })) : [{ name: "Small", price: (item.price_cents / 100).toFixed(2) }, { name: "Large", price: "" }]);
  const [sizeMode, setSizeMode] = useState<"view" | "edit" | "copy">("view");
  const [sizeDraft, setSizeDraft] = useState<SizeRow[]>(toRows);
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [sizeBusy, setSizeBusy] = useState(false);
  const [copyTargets, setCopyTargets] = useState<string[]>([]);
  const [copySearch, setCopySearch] = useState("");
  const [copiedCount, setCopiedCount] = useState<number | null>(null);

  function saveSizes(rows: SizeRow[]) {
    setSizeBusy(true);
    setSizeError(null);
    startTransition(async () => {
      const result = await setItemSizesAction(item.id, rows);
      setSizeBusy(false);
      if (!result.success) { setSizeError(result.error || "Could not save the sizes."); return; }
      setSizeMode("view");
      onRefresh();
    });
  }

  function copySizes() {
    setSizeBusy(true);
    setSizeError(null);
    startTransition(async () => {
      const result = await copyItemSizesAction(item.id, copyTargets);
      setSizeBusy(false);
      if (!result.success) { setSizeError(result.error || "Could not copy the sizes."); return; }
      setCopiedCount(result.copied ?? copyTargets.length);
      setCopyTargets([]);
      setSizeMode("view");
      onRefresh();
    });
  }

  // Items to copy to: same category first, then the rest, filtered by search.
  const copyCandidates = useMemo(() => {
    const q = copySearch.trim().toLowerCase();
    return allItems
      .filter((i) => i.id !== item.id && (!q || i.name.toLowerCase().includes(q)))
      .sort((a, b) => Number(b.category_id === item.category_id) - Number(a.category_id === item.category_id) || a.name.localeCompare(b.name))
      .slice(0, 60);
  }, [allItems, item.id, item.category_id, copySearch]);

  // Attach an existing shared add-on
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [attaching, setAttaching] = useState(false);

  // One-off group form (for an add-on that's only ever used on this one item)
  const [showOneOffForm, setShowOneOffForm] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState([{ name: "", priceDelta: "" }]);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [savingGroup, setSavingGroup] = useState(false);

  // Time-based pricing (e.g. a Breakfast Special that's cheaper 7-11am)
  const hasTimePricing = item.special_price_cents != null && ((!!item.special_price_start_time && !!item.special_price_end_time) || (item.special_price_days?.length ?? 0) > 0);
  const [showTimePricingForm, setShowTimePricingForm] = useState(false);
  const [specialPrice, setSpecialPrice] = useState(item.special_price_cents != null ? (item.special_price_cents / 100).toFixed(2) : "");
  const [startTime, setStartTime] = useState(item.special_price_start_time?.slice(0, 5) || "");
  const [endTime, setEndTime] = useState(item.special_price_end_time?.slice(0, 5) || "");
  const [specialDays, setSpecialDays] = useState<number[]>(item.special_price_days || []);
  const [timePricingError, setTimePricingError] = useState<string | null>(null);
  const [savingTimePricing, setSavingTimePricing] = useState(false);
  const timePricingSchedule = describeTimePricing({
    price_cents: item.price_cents,
    special_price_cents: item.special_price_cents,
    special_price_start_time: item.special_price_start_time,
    special_price_end_time: item.special_price_end_time,
    special_price_days: item.special_price_days,
  });

  function saveTimePricing() {
    if (specialPrice.trim() && ((startTime && !endTime) || (!startTime && endTime))) {
      setTimePricingError("Set both a start and end time, or leave both blank for all day.");
      return;
    }
    if (specialPrice.trim() && !startTime && specialDays.length === 0) {
      setTimePricingError("Pick the days it applies, set a time window, or both.");
      return;
    }
    setSavingTimePricing(true);
    setTimePricingError(null);
    startTransition(async () => {
      const result = await updateMenuItemTimePricingAction(item.id, { specialPrice, startTime, endTime, ...(specialDays.length > 0 || (item.special_price_days?.length ?? 0) > 0 ? { days: specialDays } : {}) });
      setSavingTimePricing(false);
      if (!result.success) { setTimePricingError(result.error || "Could not save time pricing."); return; }
      setShowTimePricingForm(false);
      onRefresh();
    });
  }

  function clearTimePricing() {
    setSpecialPrice(""); setStartTime(""); setEndTime(""); setSpecialDays([]);
    setSavingTimePricing(true);
    setTimePricingError(null);
    startTransition(async () => {
      const result = await updateMenuItemTimePricingAction(item.id, { specialPrice: "", startTime: "", endTime: "", ...((item.special_price_days?.length ?? 0) > 0 ? { days: [] } : {}) });
      setSavingTimePricing(false);
      if (!result.success) { setTimePricingError(result.error || "Could not clear time pricing."); return; }
      setShowTimePricingForm(false);
      onRefresh();
    });
  }

  const attachedTemplateIds = new Set(item.modifier_groups.filter((g) => g.is_template).map((g) => g.id));
  const availableTemplates = addonTemplates.filter((t) => !attachedTemplateIds.has(t.id));

  function addOptionRow() {
    setOptions((prev) => [...prev, { name: "", priceDelta: "" }]);
  }

  function saveGroup() {
    if (!groupName.trim()) { setGroupError("Group name is required."); return; }
    setSavingGroup(true);
    setGroupError(null);
    startTransition(async () => {
      const result = await addModifierGroupAction(item.id, { name: groupName, required, minSelect: required ? 1 : 0, maxSelect: 1, options });
      setSavingGroup(false);
      if (!result.success) { setGroupError(result.error || "Could not add group."); return; }
      setGroupName(""); setRequired(false); setOptions([{ name: "", priceDelta: "" }]); setShowOneOffForm(false);
      onRefresh();
    });
  }

  function removeGroup(groupId: string) {
    startTransition(async () => { await deleteModifierGroupAction(groupId); onRefresh(); });
  }

  function attachTemplate() {
    if (!selectedTemplateId) return;
    setAttaching(true);
    startTransition(async () => {
      await attachAddonTemplateAction(item.id, selectedTemplateId);
      setAttaching(false);
      setSelectedTemplateId("");
      onRefresh();
    });
  }

  function detachTemplate(templateId: string) {
    startTransition(async () => { await detachAddonTemplateAction(item.id, templateId); onRefresh(); });
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-4">
          <button className="flex flex-1 items-center gap-2 text-left" onClick={() => setExpanded((e) => !e)}>
            {expanded ? <ChevronUp className="h-3.5 w-3.5 text-text-faint" /> : <ChevronDown className="h-3.5 w-3.5 text-text-faint" />}
            <div>
              <div className="flex items-center gap-2 text-[13.5px] font-medium text-text">
                {item.name}
                {sizes && (
                  <span className="rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium text-brand-dark">{sizes.length} sizes</span>
                )}
                {otherGroups.length > 0 && (
                  <span className="rounded-full bg-paper px-1.5 py-0.5 text-[10px] font-medium text-text-faint">{otherGroups.length} add-on{otherGroups.length === 1 ? "" : "s"}</span>
                )}
                {hasTimePricing && (
                  <span className="flex items-center gap-1 rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium text-brand-dark" title={timePricingSchedule || undefined}>
                    <Clock className="h-2.5 w-2.5" /> Time pricing
                  </span>
                )}
              </div>
              <div className="text-[12px] text-text-muted">{item.description}</div>
            </div>
          </button>
          <div className="flex items-center gap-3">
            {item.price_cents === 0 && !sizes && !item.special_price_cents
              ? <div className="rounded-full bg-amber-50 px-2 py-0.5 text-[11.5px] font-medium text-amber-700">No price</div>
              : <div className="text-right text-[13px] font-semibold tabular-nums text-ink">{priceRangeText(item.price_cents, sizes)}</div>}
            <Switch checked={item.is_active} onCheckedChange={(checked) => onToggle(item.id, checked)} />
            <button onClick={() => onRemove(item.id)} className="rounded-md p-1 text-text-faint hover:bg-danger-soft hover:text-danger" aria-label="Delete item"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        </div>

        {expanded && (
          <div className="mt-4 space-y-3 border-t border-border-soft pt-4">
            {/* Details */}
            {editing ? (
              <div className="rounded-lg border border-border p-3">
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <Label className="text-[11.5px] text-text-faint">Name</Label>
                    <Input className={`mt-1 ${sameNamedOther ? "border-amber-400" : ""}`} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-[11.5px] text-text-faint">{sizesNow ? "Price (set by sizes)" : "Price ($)"}</Label>
                    <Input className="mt-1" inputMode="decimal" disabled={!!sizesNow} value={sizesNow ? priceRangeText(item.price_cents, sizesNow) : draft.price} onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value.replace(/[^0-9.]/g, "") }))} />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-[11.5px] text-text-faint">Description</Label>
                    <Input className="mt-1" value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} placeholder="Optional" />
                  </div>
                  <div>
                    <Label className="text-[11.5px] text-text-faint">Category</Label>
                    <select className="mt-1 h-10 w-full rounded-lg border border-border bg-card px-2.5 text-[13px]" value={draft.categoryId} onChange={(e) => setDraft((d) => ({ ...d, categoryId: e.target.value }))}>
                      <option value="">No category</option>
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                </div>
                {sameNamedOther && <p className="mt-2 text-[12px] text-amber-700">&ldquo;{sameNamedOther.name}&rdquo; is already on your menu.</p>}
                {editError && <p className="mt-2 text-[12px] text-danger">{editError}</p>}
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="brand" onClick={saveEdit} disabled={savingEdit || !!sameNamedOther}>{savingEdit ? "Saving…" : "Save"}</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setEditError(null); setDraft({ name: item.name, price: (item.price_cents / 100).toFixed(2), description: item.description || "", categoryId: item.category_id || "" }); }}>Cancel</Button>
                </div>
              </div>
            ) : (
              <button className="inline-flex items-center gap-1.5 text-[12px] font-medium text-brand-dark hover:text-brand" onClick={() => setEditing(true)}>
                <Pencil className="h-3.5 w-3.5" /> Edit name, price or category
              </button>
            )}

            {/* Sizes */}
            <div className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[12.5px] font-semibold text-text">Sizes</div>
                {sizeMode === "view" && sizes && (
                  <div className="flex items-center gap-3 text-[12px] font-medium">
                    <button className="text-brand-dark hover:text-brand" onClick={() => { setSizeDraft(toRows()); setSizeMode("edit"); setSizeError(null); setCopiedCount(null); }}>Edit</button>
                    <button className="text-brand-dark hover:text-brand" onClick={() => { setSizeMode("copy"); setSizeError(null); setCopiedCount(null); }}>Copy to other items</button>
                  </div>
                )}
              </div>
              {sizeMode === "view" && (
                sizes ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {sizes.map((sz) => (
                      <span key={sz.name} className="rounded-full bg-paper px-2.5 py-1 text-[12px] text-text">{sz.name} <span className="font-medium tabular-nums">${(sz.priceCents / 100).toFixed(2)}</span></span>
                    ))}
                  </div>
                ) : (
                  <button className="mt-1 text-[12px] font-medium text-text-muted hover:text-text" onClick={() => { setSizeDraft(toRows()); setSizeMode("edit"); setSizeError(null); }}>
                    + Add sizes (small, large…) with their own prices
                  </button>
                )
              )}
              {copiedCount !== null && sizeMode === "view" && <p className="mt-2 text-[12px] text-success">Copied to {copiedCount} item{copiedCount === 1 ? "" : "s"}.</p>}
              {sizeMode === "edit" && (
                <div className="mt-2">
                  <SizesEditor rows={sizeDraft} onChange={setSizeDraft} />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="brand" onClick={() => saveSizes(sizeDraft)} disabled={sizeBusy}>{sizeBusy ? "Saving…" : "Save sizes"}</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setSizeMode("view"); setSizeError(null); }} disabled={sizeBusy}>Cancel</Button>
                    {sizes && <Button size="sm" variant="ghost" onClick={() => saveSizes([])} disabled={sizeBusy}>Remove sizes</Button>}
                  </div>
                </div>
              )}
              {sizeMode === "copy" && sizes && (
                <div className="mt-2">
                  <p className="text-[12px] text-text-muted">Give these items the same sizes and prices ({sizes.map((sz) => `${sz.name} $${(sz.priceCents / 100).toFixed(2)}`).join(", ")}). Any sizes they already have are replaced.</p>
                  <Input className="mt-2" placeholder="Search items…" value={copySearch} onChange={(e) => setCopySearch(e.target.value)} />
                  <div className="mt-2 max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-border p-1.5">
                    {copyCandidates.map((c) => (
                      <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] hover:bg-paper">
                        <input type="checkbox" className="h-3.5 w-3.5 accent-[#2563EB]" checked={copyTargets.includes(c.id)} onChange={(e) => setCopyTargets((t) => (e.target.checked ? [...t, c.id] : t.filter((x) => x !== c.id)))} />
                        <span className="flex-1 truncate text-text">{c.name}</span>
                        {readSizes(c) && <span className="text-[11px] text-text-faint">has sizes</span>}
                      </label>
                    ))}
                    {copyCandidates.length === 0 && <p className="px-2 py-1.5 text-[12px] text-text-faint">No items match.</p>}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="brand" onClick={copySizes} disabled={sizeBusy || copyTargets.length === 0}>{sizeBusy ? "Copying…" : `Copy to ${copyTargets.length || ""} item${copyTargets.length === 1 ? "" : "s"}`}</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setSizeMode("view"); setCopyTargets([]); }} disabled={sizeBusy}>Cancel</Button>
                  </div>
                </div>
              )}
              {sizeError && <p className="mt-2 text-[12px] text-danger">{sizeError}</p>}
            </div>

            <div className="pt-1 text-[12.5px] font-semibold text-text">Options <span className="font-normal text-text-faint">(toppings, bread, cheese…)</span></div>
            {otherGroups.map((group) => (
              <div key={group.id} className="flex items-center justify-between rounded-lg bg-paper px-3 py-2">
                <div className="text-[12.5px] text-text">
                  <span className="font-medium">{group.name}</span>
                  {group.is_template && <span className="ml-1.5 rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium text-brand-dark">Shared</span>}
                  {group.is_required ? " (required)" : ""}: {group.modifiers.map((m) => `${m.name}${m.price_delta_cents ? ` (+$${(m.price_delta_cents / 100).toFixed(2)})` : ""}`).join(", ")}
                </div>
                <button
                  onClick={() => (group.is_template ? detachTemplate(group.id) : removeGroup(group.id))}
                  className="rounded-md p-1 text-text-faint hover:bg-danger-soft hover:text-danger"
                  aria-label={group.is_template ? "Remove from this item" : "Delete group"}
                  title={group.is_template ? "Remove from this item (the shared add-on itself isn't deleted)" : "Delete this one-off add-on"}
                >
                  {group.is_template ? <Unlink className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            ))}

            <div className={`rounded-lg p-3 ${availableTemplates.length > 0 ? EASY_TO_MISS_HIGHLIGHT : "border border-border"}`}>
              <div className="text-[12.5px] font-semibold text-text">Attach a shared add-on</div>
              <p className="mt-0.5 text-[11.5px] text-text-faint">From your add-ons library — edit it once there and it updates on every item using it.</p>
              {availableTemplates.length === 0 ? (
                <p className="mt-2 text-[12px] text-text-faint">
                  {addonTemplates.length === 0 ? "You haven't created any add-on groups yet — do that in the Add-ons library tab." : "Every add-on group is already attached to this item."}
                </p>
              ) : (
                <div className="mt-2 flex gap-2">
                  <select
                    value={selectedTemplateId}
                    onChange={(e) => setSelectedTemplateId(e.target.value)}
                    className={`h-9 flex-1 rounded-lg border bg-white px-2.5 text-[13px] outline-none ${EASY_TO_MISS_INPUT_HIGHLIGHT}`}
                  >
                    <option value="">Choose an add-on group…</option>
                    {availableTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <Button size="sm" variant="brand" onClick={attachTemplate} disabled={!selectedTemplateId || attaching}>{attaching ? "Attaching…" : "Attach"}</Button>
                </div>
              )}
            </div>

            {!showOneOffForm ? (
              <button className="text-[12px] font-medium text-text-muted hover:text-text" onClick={() => setShowOneOffForm(true)}>
                + Create a one-off add-on just for this item
              </button>
            ) : (
              <div className="rounded-lg border border-border p-3">
                <div className="text-[12.5px] font-medium text-text">One-off add-on for this item only</div>
                {groupError && <div className="mt-2 rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-[12px] text-danger">{groupError}</div>}
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <Input placeholder="Group name, e.g. Size" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
                  <label className="flex items-center gap-2 text-[12.5px] text-text-muted"><Switch checked={required} onCheckedChange={setRequired} /> Required</label>
                </div>
                <div className="mt-2 space-y-1.5">
                  {options.map((opt, i) => (
                    <div key={i} className="flex gap-2">
                      <Input placeholder="Option name" value={opt.name} onChange={(e) => setOptions((prev) => prev.map((o, idx) => (idx === i ? { ...o, name: e.target.value } : o)))} />
                      <Input placeholder="+$ (optional)" className="w-28" value={opt.priceDelta} onChange={(e) => setOptions((prev) => prev.map((o, idx) => (idx === i ? { ...o, priceDelta: e.target.value } : o)))} />
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="ghost" onClick={addOptionRow}><Plus className="h-3.5 w-3.5" /> Add option</Button>
                  <Button size="sm" variant="brand" onClick={saveGroup} disabled={savingGroup}>{savingGroup ? "Saving…" : "Save group"}</Button>
                </div>
              </div>
            )}

            <div className="border-t border-border-soft pt-3">
              {hasTimePricing && !showTimePricingForm ? (
                <div className={`flex items-center justify-between rounded-lg p-3 ${EASY_TO_MISS_HIGHLIGHT}`}>
                  <div className="flex items-center gap-1.5 text-[12.5px] text-text">
                    <Clock className="h-3.5 w-3.5 text-brand-dark" />
                    <span className="font-medium">Time-based pricing:</span> {timePricingSchedule}
                  </div>
                  <div className="flex items-center gap-1">
                    <button className="rounded-md p-1 text-text-faint hover:bg-paper hover:text-text" onClick={() => setShowTimePricingForm(true)} aria-label="Edit time pricing"><Pencil className="h-3.5 w-3.5" /></button>
                    <button className="rounded-md p-1 text-text-faint hover:bg-danger-soft hover:text-danger" onClick={clearTimePricing} disabled={savingTimePricing} aria-label="Remove time pricing"><X className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              ) : !showTimePricingForm ? (
                <button className="text-[12px] font-medium text-text-muted hover:text-text" onClick={() => setShowTimePricingForm(true)}>
                  + Add a day or time-based price (e.g. a breakfast or Tuesday special)
                </button>
              ) : (
                <div className="rounded-lg border border-border p-3">
                  <div className="text-[12.5px] font-medium text-text">Time-based price</div>
                  <p className="mt-0.5 text-[11.5px] text-text-faint">
                    Charge a different price on certain days, during certain hours, or both — like ${item.price_cents ? (item.price_cents / 100).toFixed(2) : "9.99"} normally, but $9.99 from 7-11am, or $5.00 all day Tuesday. Any other time it uses the item&apos;s regular price above.
                  </p>
                  {timePricingError && <div className="mt-2 rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-[12px] text-danger">{timePricingError}</div>}
                  <div className="mt-2">
                    <Label className="text-[11px] text-text-faint">Days (none picked = every day)</Label>
                    <div className="mt-1"><DayPicker value={specialDays} onChange={setSpecialDays} /></div>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <div>
                      <Label className="text-[11px] text-text-faint">Special price</Label>
                      <Input placeholder="9.99" value={specialPrice} onChange={(e) => setSpecialPrice(e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-[11px] text-text-faint">Start time (blank = all day)</Label>
                      <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-[11px] text-text-faint">End time</Label>
                      <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                    </div>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="brand" onClick={saveTimePricing} disabled={savingTimePricing}>{savingTimePricing ? "Saving…" : "Save"}</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setShowTimePricingForm(false); setTimePricingError(null); setSpecialPrice(item.special_price_cents != null ? (item.special_price_cents / 100).toFixed(2) : ""); setStartTime(item.special_price_start_time?.slice(0, 5) || ""); setEndTime(item.special_price_end_time?.slice(0, 5) || ""); setSpecialDays(item.special_price_days || []); }}>Cancel</Button>
                    {hasTimePricing && <Button size="sm" variant="ghost" onClick={clearTimePricing} disabled={savingTimePricing}>Remove</Button>}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// One-click starting points for the most common add-on groups. They only
// fill the form; prices are left for the owner to set.
const ADDON_STARTERS: { name: string; required: boolean; multiple: boolean; options: string[] }[] = [
  { name: "Size", required: true, multiple: false, options: ["Small", "Medium", "Large"] },
  { name: "Toppings", required: false, multiple: true, options: ["Cheese", "Onions", "Tomato", "Lettuce", "Pickles"] },
  { name: "Bread choice", required: true, multiple: false, options: ["White", "Wheat", "Rye", "Sourdough"] },
  { name: "Cheese", required: false, multiple: false, options: ["American", "Swiss", "Cheddar", "Provolone"] },
  { name: "Dressing", required: false, multiple: false, options: ["Ranch", "Italian", "Caesar", "Balsamic"] },
  { name: "Egg style", required: true, multiple: false, options: ["Scrambled", "Over easy", "Over medium", "Sunny side up"] },
];

function AddonLibraryPanel({ templates, setTemplates, onRefresh, items }: {
  templates: AddonTemplate[];
  setTemplates: (updater: (prev: AddonTemplate[]) => AddonTemplate[]) => void;
  onRefresh: () => void;
  items: MenuItemWithModifiers[];
}) {
  const [, startTransition] = useTransition();

  // New group form
  const [name, setName] = useState("");
  const [required, setRequired] = useState(false);
  const [multiple, setMultiple] = useState(false);
  const [options, setOptions] = useState([{ name: "", priceDelta: "" }, { name: "", priceDelta: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  // How many menu items each group is attached to.
  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) for (const g of item.modifier_groups) counts.set(g.id, (counts.get(g.id) || 0) + 1);
    return counts;
  }, [items]);

  function applyStarter(starter: (typeof ADDON_STARTERS)[number]) {
    setName(starter.name);
    setRequired(starter.required);
    setMultiple(starter.multiple);
    setOptions(starter.options.map((o) => ({ name: o, priceDelta: "" })));
    setError(null);
    setCreated(null);
  }

  function updateOption(index: number, patch: Partial<{ name: string; priceDelta: string }>) {
    setOptions((prev) => prev.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  }

  function createTemplate() {
    if (!name.trim()) { setError("Give the group a name, like Toppings."); return; }
    const filled = options.filter((o) => o.name.trim());
    if (filled.length === 0) { setError("Add at least one option."); return; }
    setSaving(true);
    setError(null);
    startTransition(async () => {
      const result = await createAddonTemplateAction({
        name,
        required,
        minSelect: required ? 1 : 0,
        // "Several" lets the caller pick any number of the options (toppings);
        // "one" keeps it to a single choice (size, bread).
        maxSelect: multiple ? Math.max(1, filled.length) : 1,
        options: filled,
      });
      setSaving(false);
      if (!result.success) { setError(result.error || "Could not create add-on group."); return; }
      setCreated(name.trim());
      setName(""); setRequired(false); setMultiple(false); setOptions([{ name: "", priceDelta: "" }, { name: "", priceDelta: "" }]);
      onRefresh();
    });
  }

  function removeTemplate(templateId: string) {
    setTemplates((prev) => prev.filter((t) => t.id !== templateId));
    startTransition(async () => { await deleteAddonTemplateAction(templateId); onRefresh(); });
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* Left: new group */}
      <Card className="lg:sticky lg:top-20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-soft text-brand-dark"><Tags className="h-4 w-4" /></span> New add-on group</CardTitle>
          <CardDescription className="mt-1">Make it once, attach it to as many items as you like. Editing it updates every item it&apos;s on.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">Start from</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {ADDON_STARTERS.map((st) => (
                <button key={st.name} onClick={() => applyStarter(st)} className="rounded-full border border-border bg-card px-3 py-1 text-[12.5px] font-medium text-text-muted transition-colors hover:border-brand/40 hover:bg-brand-50 hover:text-brand-dark">
                  {st.name}
                </button>
              ))}
            </div>
          </div>

          {error && <div className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{error}</div>}
          {created && !error && <div className="flex items-center gap-2 rounded-lg border border-success/20 bg-success-soft px-3.5 py-2.5 text-[12.5px] text-success"><CheckCircle2 className="h-4 w-4" /> Created &ldquo;{created}&rdquo;. Attach it from any item on the Menu items tab.</div>}

          <div><Label>Group name</Label><Input className="mt-1.5" placeholder="e.g. Toppings" value={name} onChange={(e) => { setName(e.target.value); setCreated(null); }} /></div>

          <div>
            <Label>Options</Label>
            <div className="mt-1.5 space-y-1.5">
              {options.map((opt, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Input className="h-9 flex-1" placeholder={i === 0 ? "e.g. Cheese" : "Another option"} value={opt.name} onChange={(e) => updateOption(i, { name: e.target.value })} />
                  <div className="relative w-24">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[12.5px] text-text-faint">+$</span>
                    <Input className="h-9 pl-7" placeholder="0.00" value={opt.priceDelta} onChange={(e) => updateOption(i, { priceDelta: e.target.value })} />
                  </div>
                  <button
                    onClick={() => setOptions((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : [{ name: "", priceDelta: "" }]))}
                    className="rounded-md p-1.5 text-text-faint hover:bg-danger-soft hover:text-danger"
                    aria-label="Remove option"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <button onClick={() => setOptions((prev) => [...prev, { name: "", priceDelta: "" }])} className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-brand hover:underline">
              <Plus className="h-3.5 w-3.5" /> Add option
            </button>
          </div>

          <div className="space-y-2.5 rounded-xl bg-paper p-3">
            <label className="flex items-center justify-between gap-3 text-[13px] text-text">
              <span>Customer must choose one<span className="block text-[11.5px] text-text-faint">The AI won&apos;t add the item until they pick</span></span>
              <Switch checked={required} onCheckedChange={setRequired} />
            </label>
            <label className="flex items-center justify-between gap-3 text-[13px] text-text">
              <span>Can pick more than one<span className="block text-[11.5px] text-text-faint">On for toppings, off for size or bread</span></span>
              <Switch checked={multiple} onCheckedChange={setMultiple} />
            </label>
          </div>

          <Button variant="brand" className="w-full" onClick={createTemplate} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create add-on group
          </Button>
        </CardContent>
      </Card>

      {/* Right: existing groups */}
      <div className="min-w-0">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="font-display text-[15px] font-semibold text-ink">Your add-on groups</h3>
          <span className="text-[12px] text-text-faint">{templates.length} group{templates.length === 1 ? "" : "s"}</span>
        </div>
        {templates.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-8 text-center">
            <Tags className="mx-auto h-6 w-6 text-text-faint" />
            <p className="mt-2 text-[13px] font-medium text-ink">No add-on groups yet</p>
            <p className="mt-0.5 text-[12.5px] text-text-muted">Pick a starter on the left, or make your own.</p>
          </div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {templates.map((template) => (
              <AddonTemplateRow key={template.id} template={template} usedOn={usage.get(template.id) || 0} onRemove={removeTemplate} onRefresh={onRefresh} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AddonTemplateRow({ template, usedOn, onRemove, onRefresh }: {
  template: AddonTemplate;
  usedOn: number;
  onRemove: (id: string) => void;
  onRefresh: () => void;
}) {
  const [, startTransition] = useTransition();
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(template.name);
  const [adding, setAdding] = useState(false);
  const [newOptionName, setNewOptionName] = useState("");
  const [newOptionPrice, setNewOptionPrice] = useState("");

  function saveRename() {
    if (!nameDraft.trim() || nameDraft === template.name) { setRenaming(false); return; }
    startTransition(async () => { await renameAddonTemplateAction(template.id, nameDraft); setRenaming(false); onRefresh(); });
  }

  function addOption() {
    if (!newOptionName.trim()) return;
    startTransition(async () => {
      await addAddonTemplateOptionAction(template.id, newOptionName, newOptionPrice);
      setNewOptionName(""); setNewOptionPrice("");
      onRefresh();
    });
  }

  function removeOption(modifierId: string) {
    startTransition(async () => { await deleteAddonOptionAction(modifierId); onRefresh(); });
  }

  const pickMany = (template.max_select ?? 1) > 1;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {renaming ? (
            <div className="flex items-center gap-2">
              <Input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveRename(); }} className="h-8" autoFocus />
              <Button size="sm" variant="brand" onClick={saveRename}>Save</Button>
            </div>
          ) : (
            <button className="group flex items-center gap-1.5 text-left font-display text-[14px] font-semibold text-ink hover:text-brand-dark" onClick={() => { setNameDraft(template.name); setRenaming(true); }}>
              {template.name}
              <Pencil className="h-3 w-3 text-text-faint opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px]">
            {template.is_required && <span className="rounded-full bg-brand-soft px-2 py-0.5 font-medium text-brand-dark">Required</span>}
            <span className="rounded-full bg-paper px-2 py-0.5 text-text-muted">{pickMany ? "Pick any" : "Pick one"}</span>
            <span className="text-text-faint">{usedOn === 0 ? "Not on any items yet" : `On ${usedOn} item${usedOn === 1 ? "" : "s"}`}</span>
          </div>
        </div>
        <button onClick={() => onRemove(template.id)} className="rounded-md p-1 text-text-faint hover:bg-danger-soft hover:text-danger" aria-label="Delete add-on group"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {template.modifiers.map((m) => (
          <span key={m.id} className="group inline-flex items-center gap-1 rounded-full border border-border bg-paper py-0.5 pl-2.5 pr-1 text-[12px] text-text">
            {m.name}
            {m.price_delta_cents ? <span className="text-text-faint">+${(m.price_delta_cents / 100).toFixed(2)}</span> : null}
            <button onClick={() => removeOption(m.id)} className="rounded-full p-0.5 text-text-faint hover:bg-danger-soft hover:text-danger" aria-label={`Remove ${m.name}`}><X className="h-3 w-3" /></button>
          </span>
        ))}
        {!adding && (
          <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded-full border border-dashed border-brand/40 px-2.5 py-0.5 text-[12px] font-medium text-brand hover:bg-brand-50">
            <Plus className="h-3 w-3" /> Option
          </button>
        )}
      </div>

      {adding && (
        <div className="mt-2.5 flex gap-1.5">
          <Input placeholder="e.g. Bacon" className="h-8 flex-1" value={newOptionName} autoFocus onChange={(e) => setNewOptionName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addOption(); }} />
          <Input placeholder="+$" className="h-8 w-20" value={newOptionPrice} onChange={(e) => setNewOptionPrice(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addOption(); }} />
          <Button size="sm" variant="brand" onClick={addOption}>Add</Button>
          <button onClick={() => setAdding(false)} className="rounded-md px-1.5 text-text-faint hover:text-ink" aria-label="Cancel"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
    </div>
  );
}

function MenuImportPanel({ onImported, existingNames }: { onImported: () => void; existingNames: string[] }) {
  const [, startTransition] = useTransition();
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [staged, setStaged] = useState<ExtractedMenuItem[] | null>(null);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState<string | null>(null);
  // Duplicates are combined as soon as anything is read (overlapping photos,
  // an item on two pages, the same item spelled two ways). Items already on
  // the menu are shown but never added again.
  const [priceConflicts, setPriceConflicts] = useState<Record<string, string[]>>({});
  const [mergedCount, setMergedCount] = useState(0);
  const existingKeys = useMemo(() => new Set(existingNames.map(menuNameKey)), [existingNames]);
  function stage(items: ExtractedMenuItem[]) {
    const d = dedupeImportItems(items);
    setStaged(d.items);
    setPriceConflicts(d.priceConflicts);
    setMergedCount(d.merged);
  }
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Which import method is open. One at a time, so the page shows one
  // thing to do instead of three long forms.
  const [method, setMethod] = useState<"website" | "photo" | "paste">("website");

  // Claude's vision models resize any image down to ~1568px on the
  // long edge before reading it anyway — sending more than that is
  // pure wasted upload time and processing time, which is exactly
  // what pushed a full-resolution phone photo (often 8-12MP) past
  // Vercel's function timeout. Shrinking to that same size ourselves,
  // right in the browser, means the request that reaches the server
  // is a fraction of the size with no loss in what the AI can
  // actually read.
  const MAX_MENU_PHOTO_DIMENSION = 1568;

  function resizeImageFile(file: File): Promise<{ base64: string; mediaType: "image/jpeg" }> {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const img = new window.Image();
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        let { width, height } = img;
        if (width > MAX_MENU_PHOTO_DIMENSION || height > MAX_MENU_PHOTO_DIMENSION) {
          const scale = MAX_MENU_PHOTO_DIMENSION / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("This browser can't process images.")); return; }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        resolve({ base64: dataUrl.split(",")[1], mediaType: "image/jpeg" });
      };
      img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Could not read that photo.")); };
      img.src = objectUrl;
    });
  }

  function fromWebsite() {
    setImporting(true);
    setImportError(null);
    setStaged(null);
    setCommitted(null);
    startTransition(async () => {
      const result = await extractMenuFromWebsiteAction(websiteUrl);
      setImporting(false);
      if (!result.success) { setImportError(result.error || "Could not import from that website."); return; }
      stage(result.items || []);
    });
  }

  function fromText() {
    setImporting(true);
    setImportError(null);
    setStaged(null);
    setCommitted(null);
    startTransition(async () => {
      const result = await extractMenuFromTextAction(pastedText);
      setImporting(false);
      if (!result.success) { setImportError(result.error || "Could not read that text."); return; }
      stage(result.items || []);
    });
  }

  // ── Photos and files: several at once, read one after another ──
  type PickedKind = "image" | "pdf" | "csv" | "text";
  type Picked = { id: string; file: File; kind: PickedKind; preview?: string };
  const MAX_FILES = 12;
  const [picked, setPicked] = useState<Picked[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [importNotes, setImportNotes] = useState<string[]>([]);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  function kindOf(file: File): PickedKind | null {
    const n = file.name.toLowerCase();
    if (file.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/.test(n)) return "image";
    if (file.type === "application/pdf" || n.endsWith(".pdf")) return "pdf";
    if (n.endsWith(".csv") || file.type === "text/csv") return "csv";
    if (n.endsWith(".txt") || file.type === "text/plain") return "text";
    return null;
  }

  function addFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files || []);
    e.target.value = "";
    if (list.length === 0) return;
    setImportError(null);
    const rejected: string[] = [];
    const next: Picked[] = [];
    for (const file of list) {
      const kind = kindOf(file);
      if (!kind) { rejected.push(file.name); continue; }
      next.push({ id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`, file, kind, preview: kind === "image" ? URL.createObjectURL(file) : undefined });
    }
    setPicked((prev) => {
      const merged = [...prev, ...next];
      if (merged.length > MAX_FILES) setImportError(`Up to ${MAX_FILES} files at a time. Read these first, then add more.`);
      return merged.slice(0, MAX_FILES);
    });
    if (rejected.length) setImportError(`Can't read ${rejected.join(", ")}. Use photos, PDFs, or CSV/text files (save Excel sheets as CSV).`);
  }

  function removePicked(id: string) {
    setPicked((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return prev.filter((p) => p.id !== id);
    });
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = () => reject(new Error("Could not open that file."));
      reader.readAsDataURL(file);
    });
  }

  async function readPicked() {
    if (picked.length === 0) return;
    setImporting(true);
    setImportError(null);
    setStaged(null);
    setCommitted(null);
    setImportNotes([]);
    const found: ExtractedMenuItem[] = [];
    const notes: string[] = [];
    const failed: string[] = [];

    for (let i = 0; i < picked.length; i++) {
      const { file, kind } = picked[i];
      setProgress(`Reading ${file.name} (${i + 1} of ${picked.length})…`);
      try {
        if (kind === "image") {
          const { base64, mediaType } = await resizeImageFile(file);
          const result = await extractMenuFromImageAction(base64, mediaType);
          if (!result.success) throw new Error(result.error);
          if ((result.items || []).length === 0) notes.push(`No menu items found in ${file.name}.`);
          found.push(...(result.items || []));
        } else if (kind === "pdf") {
          const result = await extractMenuFromPdfAction(await fileToBase64(file));
          if (!result.success) throw new Error(result.error);
          if ((result.items || []).length === 0) notes.push(`No menu items found in ${file.name}.`);
          found.push(...(result.items || []));
        } else {
          const text = await file.text();
          const csv = kind === "csv" ? parseMenuCsv(text) : null;
          if (csv) {
            found.push(...csv.items);
            const extra = [csv.skippedOptionRows ? `skipped ${csv.skippedOptionRows} option-list rows like "{Combo}"` : "", csv.duplicateRows ? `combined ${csv.duplicateRows} repeated item${csv.duplicateRows === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");
            notes.push(`${file.name}: ${csv.items.length} items${extra ? `, ${extra}` : ""}.`);
          } else {
            const result = await extractMenuFromTextAction(text.slice(0, 60_000));
            if (!result.success) throw new Error(result.error);
            found.push(...(result.items || []));
          }
        }
      } catch (err) {
        failed.push(`${file.name}${err instanceof Error && err.message ? ` (${err.message})` : ""}`);
      }
    }

    const merged = dedupeImportItems(found).items;
    const zeroPriced = merged.filter((it) => !(parseFloat(it.priceDollars) > 0)).length;
    if (zeroPriced) notes.push(`${zeroPriced} item${zeroPriced === 1 ? " has" : "s have"} no price yet. They're highlighted below.`);
    setImporting(false);
    setProgress(null);
    setImportNotes(notes);
    if (failed.length) setImportError(`Couldn't read: ${failed.join("; ")}.`);
    stage(found);
    picked.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
    setPicked([]);
  }

  function updateStagedItem(index: number, patch: Partial<ExtractedMenuItem>) {
    setStaged((prev) => (prev ? prev.map((item, i) => (i === index ? { ...item, ...patch } : item)) : prev));
  }

  function removeStagedItem(index: number) {
    setStaged((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
  }

  // What will actually be added: edits on the review screen can make two
  // rows match again, and items already on the menu are left out.
  const toAdd = useMemo(() => (staged ? dedupeImportItems(staged).items.filter((it) => !existingKeys.has(menuNameKey(it.name))) : []), [staged, existingKeys]);
  const alreadyOnMenu = staged ? staged.filter((it) => existingKeys.has(menuNameKey(it.name))).length : 0;

  function commit() {
    if (toAdd.length === 0) return;
    setCommitting(true);
    startTransition(async () => {
      const result = await importMenuItemsAction(toAdd);
      setCommitting(false);
      if (result.success) {
        const added = result.added ?? toAdd.length;
        setCommitted(`Added ${added} item${added === 1 ? "" : "s"} to your menu${result.skipped ? `, and skipped ${result.skipped} that ${result.skipped === 1 ? "was" : "were"} already on it` : ""}.`);
        setStaged(null);
        onImported();
      } else {
        setImportError(result.error || "Could not save these items.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-[15px] font-semibold text-ink">How do you want to bring your menu in?</h2>
        <p className="mt-0.5 text-[12.5px] text-text-muted">Everything is read from your real menu — nothing is invented — and you review it before anything is added.</p>
        <div role="tablist" aria-label="Import method" className="mt-3 grid gap-3 sm:grid-cols-3">
          {([
            { key: "website", icon: Globe, title: "From your website", line: "Paste your menu page's address" },
            { key: "photo", icon: Camera, title: "Photos or files", line: "Several photos, a PDF, or a POS export (CSV)" },
            { key: "paste", icon: ClipboardPaste, title: "Paste text", line: "Works for Toast, ChowNow and any site" },
          ] as const).map((m) => {
            const selected = method === m.key;
            const Icon = m.icon;
            return (
              <button
                key={m.key}
                role="tab"
                aria-selected={selected}
                onClick={() => { setMethod(m.key); setImportError(null); }}
                className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition-all ${
                  selected ? "border-brand bg-brand-50 shadow-card ring-1 ring-brand" : "border-border bg-card hover:border-brand/40 hover:bg-brand-50/50"
                }`}
              >
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${selected ? "bg-brand text-white" : "bg-brand-soft text-brand-dark"}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold text-ink">{m.title}</span>
                  <span className="mt-0.5 block text-[12px] text-text-muted">{m.line}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <Card>
        <CardContent className="p-5">
          {method === "website" && (
            <div>
              <Label>Menu page address</Label>
              <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
                <Input placeholder="yourrestaurant.com/menu" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && websiteUrl.trim() && !importing) fromWebsite(); }} />
                <Button variant="brand" onClick={fromWebsite} disabled={importing || !websiteUrl.trim()}>
                  {importing ? <><Loader2 className="h-4 w-4 animate-spin" /> Reading…</> : <><Globe className="h-4 w-4" /> Import</>}
                </Button>
              </div>
              <p className="mt-2 text-[12px] text-text-faint">Doesn&apos;t work on online-ordering pages (Toast, ChowNow and similar). For those, use <button onClick={() => setMethod("paste")} className="font-medium text-brand hover:underline">Paste text</button>.</p>
            </div>
          )}

          {method === "photo" && (
            <div className="space-y-3">
              <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-brand/30 bg-brand-50/50 px-4 py-7 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft text-brand-dark"><Upload className="h-6 w-6" /></span>
                <div>
                  <div className="text-[14px] font-semibold text-ink">Add photos of every menu page, or upload files</div>
                  <p className="mt-0.5 text-[12px] text-text-muted">Photos, a PDF menu, or a CSV export from your POS. Add as many as you need (up to {MAX_FILES} at a time), then read them all at once.</p>
                </div>
                <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={addFiles} className="hidden" />
                <input ref={fileInputRef} type="file" multiple accept="image/*,.heic,.heif,application/pdf,.pdf,.csv,text/csv,.txt,text/plain" onChange={addFiles} className="hidden" />
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="outline" onClick={() => cameraInputRef.current?.click()} disabled={importing}><Camera className="h-4 w-4" /> Take a photo</Button>
                  <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importing}><Upload className="h-4 w-4" /> Choose photos or files</Button>
                </div>
                <p className="text-[11.5px] text-text-faint">Flat, well-lit and straight-on photos read best. Excel sheet? Save it as CSV first.</p>
              </div>

              {picked.length > 0 && (
                <div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {picked.map((p) => (
                      <div key={p.id} className="relative overflow-hidden rounded-xl border border-border bg-paper">
                        {p.preview ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.preview} alt={p.file.name} className="h-24 w-full object-cover" />
                        ) : (
                          <div className="flex h-24 items-center justify-center text-brand-dark">
                            {p.kind === "csv" ? <FileSpreadsheet className="h-8 w-8" /> : <FileText className="h-8 w-8" />}
                          </div>
                        )}
                        <div className="truncate px-2 py-1.5 text-[11.5px] text-text-muted" title={p.file.name}>{p.file.name}</div>
                        <button
                          type="button"
                          onClick={() => removePicked(p.id)}
                          disabled={importing}
                          className="absolute right-1.5 top-1.5 rounded-full bg-ink/70 p-1 text-white hover:bg-ink"
                          aria-label={`Remove ${p.file.name}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <Button variant="brand" className="mt-3" onClick={readPicked} disabled={importing}>
                    {importing ? <><Loader2 className="h-4 w-4 animate-spin" /> Reading…</> : <>Read {picked.length} file{picked.length === 1 ? "" : "s"}</>}
                  </Button>
                </div>
              )}
            </div>
          )}

          {method === "paste" && (
            <div className="space-y-3">
              <ol className="grid gap-2 text-[12.5px] text-text-muted sm:grid-cols-3">
                {["Open your menu page in your browser (any site works)", "Select all the text and copy it — open items first to include their add-ons", "Paste it below"].map((step, i) => (
                  <li key={step} className="flex gap-2 rounded-lg bg-paper px-3 py-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand text-[11px] font-semibold text-white">{i + 1}</span>
                    {step}
                  </li>
                ))}
              </ol>
              <Textarea value={pastedText} onChange={(e) => setPastedText(e.target.value)} placeholder="Paste your menu text here…" className="min-h-[160px]" />
              <Button variant="brand" onClick={fromText} disabled={importing || pastedText.trim().length < 20}>
                {importing ? <><Loader2 className="h-4 w-4 animate-spin" /> Reading…</> : <><ClipboardPaste className="h-4 w-4" /> Import from pasted text</>}
              </Button>
            </div>
          )}

          {importing && (
            <p className="mt-3 flex items-center gap-2 text-[12px] text-text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin text-brand" /> {progress || "Reading your menu. This can take up to a minute."} Stay on this page.</p>
          )}
        </CardContent>
      </Card>

      {importError && <div className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{importError}</div>}
      {importNotes.length > 0 && staged && (
        <ul className="space-y-1 rounded-lg border border-border bg-paper px-3.5 py-2.5 text-[12.5px] text-text-muted">
          {importNotes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
      {committed && <div className="flex items-center gap-2 rounded-lg border border-success/20 bg-success-soft px-3.5 py-2.5 text-[12.5px] text-success"><CheckCircle2 className="h-3.5 w-3.5" /> {committed}</div>}

      {staged && (
        <Card>
          <CardHeader>
            <CardTitle>Review before adding — {staged.length} item{staged.length === 1 ? "" : "s"} found</CardTitle>
            <CardDescription>
              Check every name and price against your real menu before confirming. Nothing here is live yet.
              {mergedCount > 0 && ` ${mergedCount} repeat${mergedCount === 1 ? " was" : "s were"} combined, so each item appears once.`}
              {alreadyOnMenu > 0 && ` ${alreadyOnMenu} ${alreadyOnMenu === 1 ? "is" : "are"} already on your menu and won't be added again.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {staged.length === 0 ? (
              <p className="text-[13px] text-text-muted">Nothing readable was found. Try a clearer photo or a different page.</p>
            ) : (
              staged.map((item, i) => {
                const key = menuNameKey(item.name);
                const onMenu = existingKeys.has(key);
                const conflict = priceConflicts[key];
                return (
                <div key={i} className={`rounded-lg border p-3 ${onMenu ? "border-border bg-paper opacity-60" : parseFloat(item.priceDollars) > 0 && !conflict ? "border-border" : "border-amber-300 bg-amber-50/60"}`}>
                {(onMenu || conflict) && (
                  <p className={`mb-2 text-[12px] font-medium ${onMenu ? "text-text-muted" : "text-amber-800"}`}>
                    {onMenu ? "Already on your menu. It won't be added again." : `Found at different prices: ${conflict!.map((c) => `$${c}`).join(" and ")}. Check which is right, or add it with sizes after importing.`}
                  </p>
                )}
                <div className="grid gap-2 sm:grid-cols-[1.2fr,1fr,1fr,100px,auto]">
                  <Input value={item.name} onChange={(e) => updateStagedItem(i, { name: e.target.value })} placeholder="Name" aria-label="Name" />
                  <Input value={item.category} onChange={(e) => updateStagedItem(i, { category: e.target.value })} placeholder="Category" aria-label="Category" />
                  <Input value={item.description} onChange={(e) => updateStagedItem(i, { description: e.target.value })} placeholder="Description" aria-label="Description" />
                  <Input value={item.priceDollars} onChange={(e) => updateStagedItem(i, { priceDollars: e.target.value })} placeholder="Price" aria-label="Price" className={parseFloat(item.priceDollars) > 0 ? "" : "border-amber-400"} />
                  <button onClick={() => removeStagedItem(i)} className="justify-self-end rounded-md p-1 text-text-faint hover:bg-danger-soft hover:text-danger" aria-label="Remove from import"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
                </div>
                );
              })
            )}
            {staged.length > 0 && (
              <Button variant="brand" onClick={commit} disabled={committing || toAdd.length === 0}>
                {committing ? "Adding…" : toAdd.length === 0 ? "Everything here is already on your menu" : `Add ${toAdd.length} item${toAdd.length === 1 ? "" : "s"} to menu`}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
