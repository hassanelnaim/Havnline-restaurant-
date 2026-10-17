"use client";
import { useState, useTransition, useRef, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Unlink, Globe, Camera, ClipboardPaste, Loader2, UtensilsCrossed, ChevronDown, ChevronUp, CheckCircle2, Search, Tags, Pencil, Clock, X, Percent } from "lucide-react";
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
  updateMenuItemTimePricingAction,
  extractMenuFromWebsiteAction, extractMenuFromTextAction, extractMenuFromImageAction, importMenuItemsAction,
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
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  // Which category tab the list on the right shows.
  const [activeCategory, setActiveCategory] = useState<string>(ALL);
  // On a phone the add form is tucked behind a button so the menu comes first.
  const [showAddOnPhone, setShowAddOnPhone] = useState(false);

  function refresh() {
    router.refresh();
  }

  function addItem() {
    if (!name.trim() || !price.trim()) { setError("Name and price are required."); return; }
    setSaving(true);
    setError(null);
    startTransition(async () => {
      const isNew = categoryChoice === NEW_CATEGORY;
      if (isNew && !newCategory.trim()) { setSaving(false); setError("Type a name for the new category, or pick an existing one."); return; }
      const result = await addMenuItemAction({
        name,
        description,
        price,
        categoryId: isNew || !categoryChoice ? null : categoryChoice,
        newCategoryName: isNew ? newCategory : undefined,
      });
      setSaving(false);
      if (!result.success) { setError(result.error || "Could not add item."); return; }
      setJustAdded(name.trim());
      setName(""); setDescription(""); setPrice("");
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
    const visible = q
      ? items.filter((i) => i.name.toLowerCase().includes(q) || (i.description || "").toLowerCase().includes(q))
      : items;

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
  }, [items, categories, search]);

  const totalVisible = groupedItems.reduce((sum, g) => sum + g.items.length, 0);
  const searching = search.trim().length > 0;

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
        <div className="grid items-start gap-6 lg:grid-cols-2">
          {/* Left: add an item. On a phone it sits behind a button, below the menu. */}
          <div className={`order-2 lg:order-1 lg:sticky lg:top-20 ${showAddOnPhone ? "" : "hidden lg:block"}`}>
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-soft text-brand-dark"><Plus className="h-4 w-4" /></span> Add a menu item</CardTitle>
                    <CardDescription className="mt-1">Your AI only offers items and prices listed here — never invented.</CardDescription>
                  </div>
                  <button onClick={() => setShowAddOnPhone(false)} className="rounded-md p-1 text-text-faint hover:bg-paper lg:hidden" aria-label="Close"><X className="h-4 w-4" /></button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {error && <div className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{error}</div>}
                {justAdded && !error && (
                  <div className="flex items-center gap-2 rounded-lg border border-success/20 bg-success-soft px-3.5 py-2.5 text-[12.5px] text-success">
                    <CheckCircle2 className="h-4 w-4" /> Added &ldquo;{justAdded}&rdquo; to your menu.
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-2"><Label>Name</Label><Input className="mt-1.5" value={name} onChange={(e) => { setName(e.target.value); setJustAdded(null); }} placeholder="e.g. Cheeseburger" /></div>
                  <div><Label>Price ($)</Label><Input type="number" step="0.01" min="0" className="mt-1.5" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" /></div>
                </div>
                <div><Label>Description</Label><Input className="mt-1.5" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional — what comes on it" /></div>
                <div>
                  <Label>Category</Label>
                  <select
                    className="mt-1.5 h-10 w-full rounded-lg border border-border bg-card px-3 text-[13.5px] text-text"
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
                <Button variant="brand" className="w-full" onClick={addItem} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add item
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Right: the menu, one category at a time. */}
          <div className="order-1 min-w-0 lg:order-2">
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
                  <Button variant="brand" size="sm" className="lg:hidden" onClick={() => setShowAddOnPhone(true)}><Plus className="h-3.5 w-3.5" /> Add item</Button>
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
        <MenuImportPanel onImported={refresh} />
      </TabsContent>
    </Tabs>
  );
}

function MenuItemRow({ item, addonTemplates, onToggle, onRemove, onRefresh }: {
  item: MenuItemWithModifiers;
  addonTemplates: AddonTemplate[];
  onToggle: (id: string, active: boolean) => void;
  onRemove: (id: string) => void;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [, startTransition] = useTransition();

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
                {item.modifier_groups.length > 0 && (
                  <span className="rounded-full bg-paper px-1.5 py-0.5 text-[10px] font-medium text-text-faint">{item.modifier_groups.length} add-on{item.modifier_groups.length === 1 ? "" : "s"}</span>
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
            <div className="text-[13px] font-semibold tabular-nums text-ink">${(item.price_cents / 100).toFixed(2)}</div>
            <Switch checked={item.is_active} onCheckedChange={(checked) => onToggle(item.id, checked)} />
            <button onClick={() => onRemove(item.id)} className="rounded-md p-1 text-text-faint hover:bg-danger-soft hover:text-danger" aria-label="Delete item"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        </div>

        {expanded && (
          <div className="mt-4 space-y-3 border-t border-border-soft pt-4">
            {item.modifier_groups.map((group) => (
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

function MenuImportPanel({ onImported }: { onImported: () => void }) {
  const [, startTransition] = useTransition();
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [staged, setStaged] = useState<ExtractedMenuItem[] | null>(null);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState(false);
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
    setCommitted(false);
    startTransition(async () => {
      const result = await extractMenuFromWebsiteAction(websiteUrl);
      setImporting(false);
      if (!result.success) { setImportError(result.error || "Could not import from that website."); return; }
      setStaged(result.items || []);
    });
  }

  function fromText() {
    setImporting(true);
    setImportError(null);
    setStaged(null);
    setCommitted(false);
    startTransition(async () => {
      const result = await extractMenuFromTextAction(pastedText);
      setImporting(false);
      if (!result.success) { setImportError(result.error || "Could not read that text."); return; }
      setStaged(result.items || []);
    });
  }

  async function fromPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportError(null);
    setStaged(null);
    setCommitted(false);
    try {
      const { base64, mediaType } = await resizeImageFile(file);
      const result = await extractMenuFromImageAction(base64, mediaType);
      setImporting(false);
      if (!result.success) { setImportError(result.error || "Could not read that photo."); return; }
      setStaged(result.items || []);
    } catch {
      setImporting(false);
      setImportError("Could not read that photo. Try a clearer picture.");
    }
    e.target.value = "";
  }

  function updateStagedItem(index: number, patch: Partial<ExtractedMenuItem>) {
    setStaged((prev) => (prev ? prev.map((item, i) => (i === index ? { ...item, ...patch } : item)) : prev));
  }

  function removeStagedItem(index: number) {
    setStaged((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
  }

  function commit() {
    if (!staged || staged.length === 0) return;
    setCommitting(true);
    startTransition(async () => {
      const result = await importMenuItemsAction(staged);
      setCommitting(false);
      if (result.success) {
        setCommitted(true);
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
            { key: "photo", icon: Camera, title: "From a photo", line: "A printed menu, price list or screenshot" },
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
            <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-brand/30 bg-brand-50/50 px-4 py-8 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft text-brand-dark"><Camera className="h-6 w-6" /></span>
              <div>
                <div className="text-[14px] font-semibold text-ink">Take or upload a photo of your menu</div>
                <p className="mt-0.5 text-[12px] text-text-muted">A printed menu, price list, or a PDF page saved as an image. Flat, well-lit and straight-on works best.</p>
              </div>
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={fromPhoto} className="hidden" />
              <Button variant="brand" onClick={() => fileInputRef.current?.click()} disabled={importing}>
                {importing ? <><Loader2 className="h-4 w-4 animate-spin" /> Reading…</> : <><Camera className="h-4 w-4" /> Choose a photo</>}
              </Button>
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
            <p className="mt-3 flex items-center gap-2 text-[12px] text-text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin text-brand" /> Reading your menu — this can take up to a minute. You can stay on this page.</p>
          )}
        </CardContent>
      </Card>

      {importError && <div className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{importError}</div>}
      {committed && <div className="flex items-center gap-2 rounded-lg border border-success/20 bg-success-soft px-3.5 py-2.5 text-[12.5px] text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Menu items added.</div>}

      {staged && (
        <Card>
          <CardHeader>
            <CardTitle>Review before adding — {staged.length} item{staged.length === 1 ? "" : "s"} found</CardTitle>
            <CardDescription>Check every name and price against your real menu before confirming. Nothing here is live yet.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {staged.length === 0 ? (
              <p className="text-[13px] text-text-muted">Nothing readable was found. Try a clearer photo or a different page.</p>
            ) : (
              staged.map((item, i) => (
                <div key={i} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr,1fr,100px,auto]">
                  <Input value={item.name} onChange={(e) => updateStagedItem(i, { name: e.target.value })} placeholder="Name" />
                  <Input value={item.description} onChange={(e) => updateStagedItem(i, { description: e.target.value })} placeholder="Description" />
                  <Input value={item.priceDollars} onChange={(e) => updateStagedItem(i, { priceDollars: e.target.value })} placeholder="Price" />
                  <button onClick={() => removeStagedItem(i)} className="justify-self-end rounded-md p-1 text-text-faint hover:bg-danger-soft hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))
            )}
            {staged.length > 0 && (
              <Button variant="brand" onClick={commit} disabled={committing}>{committing ? "Adding…" : `Add ${staged.length} item${staged.length === 1 ? "" : "s"} to menu`}</Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
