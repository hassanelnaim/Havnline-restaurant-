"use client";
import { useState, useTransition, useRef, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Globe, Camera, ClipboardPaste, Loader2, CheckCircle2, Tags, Pencil, X, Percent, FileText, FileSpreadsheet, Upload, Copy as CopyIcon, AlertTriangle } from "lucide-react";
import type { DbMenuCategory, MenuItemWithModifiers } from "@/lib/database/types";
import type { AddonTemplate } from "@/lib/data/menu";
import {
  toggleMenuItemActiveAction,
  createAddonTemplateAction, renameAddonTemplateAction, addAddonTemplateOptionAction, deleteAddonOptionAction, deleteAddonTemplateAction,
  removeDuplicateItemsAction,
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
import { PromotionsPanel } from "@/components/dashboard/promotions-panel";
import { MenuItemsTab } from "@/components/dashboard/menu-items-tab";
import { readSizes, priceRangeText, isSizeGroup } from "@/lib/menu/sizes";
import { parseMenuCsv } from "@/lib/menu/csvImport";
import { dedupeImportItems, menuNameKey } from "@/lib/menu/importDedupe";


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

  function refresh() {
    router.refresh();
  }

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

  function toggleActive(itemId: string, isActive: boolean) {
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, is_active: isActive } : i)));
    startTransition(async () => { await toggleMenuItemActiveAction(itemId, isActive); });
  }

  return (
    <Tabs defaultValue={initialTab ?? "items"}>
      <TabsList className="flex-wrap">
        <TabsTrigger value="items">Menu items</TabsTrigger>
        <TabsTrigger value="addons"><Tags className="h-3.5 w-3.5" /> Add-ons</TabsTrigger>
        {promotions && <TabsTrigger value="promotions"><Percent className="h-3.5 w-3.5" /> Promotions</TabsTrigger>}
        <TabsTrigger value="import"><Globe className="h-3.5 w-3.5" /> Import</TabsTrigger>
      </TabsList>

      <TabsContent value="items">
        {unpricedCount > 0 && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
            <span className="flex items-center gap-2 text-[13px] font-medium text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {unpricedCount} item{unpricedCount === 1 ? " has" : "s have"} no price, so your AI won&apos;t sell {unpricedCount === 1 ? "it" : "them"} over the phone. Add a price or sizes.
            </span>
            <Button size="sm" variant="outline" onClick={() => setOnlyUnpriced((v) => !v)}>{onlyUnpriced ? "Show all items" : "Show them"}</Button>
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
        <MenuItemsTab
          items={items}
          categories={categories}
          addonTemplates={addonTemplates}
          onToggle={toggleActive}
          onRefresh={refresh}
          onRemoved={(id) => setItems((prev) => prev.filter((i) => i.id !== id))}
          onlyUnpriced={onlyUnpriced}
        />
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

// One-click starting points for the most common add-on groups. They only
// fill the form; prices are left for the owner to set.
const ADDON_STARTERS: { name: string; required: boolean; multiple: boolean; options: string[] }[] = [
  { name: "Size", required: true, multiple: false, options: ["Small", "Medium", "Large"] },
  // Optional on purpose: the AI offers it ("Want to make that a combo?")
  // rather than requiring an answer. Set the price of the upgrade.
  { name: "Make it a combo", required: false, multiple: false, options: ["Combo with fries and a drink"] },
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
