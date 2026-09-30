"use client";
import { useState, useTransition, useRef, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Unlink, Globe, Camera, ClipboardPaste, Loader2, UtensilsCrossed, ChevronDown, ChevronUp, CheckCircle2, Search, Tags, Pencil } from "lucide-react";
import type { DbMenuCategory, MenuItemWithModifiers } from "@/lib/database/types";
import type { AddonTemplate } from "@/lib/data/menu";
import { EASY_TO_MISS_HIGHLIGHT, EASY_TO_MISS_INPUT_HIGHLIGHT } from "@/lib/ui/highlight";
import {
  addMenuItemAction, updateMenuItemAction, deleteMenuItemAction, toggleMenuItemActiveAction,
  addModifierGroupAction, deleteModifierGroupAction,
  createAddonTemplateAction, renameAddonTemplateAction, addAddonTemplateOptionAction, deleteAddonOptionAction, deleteAddonTemplateAction,
  attachAddonTemplateAction, detachAddonTemplateAction,
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

const UNCATEGORIZED = "__uncategorized__";

export function MenuClient({
  initialCategories,
  initialItems,
  initialAddonTemplates,
}: {
  initialCategories: DbMenuCategory[];
  initialItems: MenuItemWithModifiers[];
  initialAddonTemplates: AddonTemplate[];
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
  const [category, setCategory] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function refresh() {
    router.refresh();
  }

  function addItem() {
    if (!name.trim() || !price.trim()) { setError("Name and price are required."); return; }
    setSaving(true);
    setError(null);
    startTransition(async () => {
      const categoryId = categories.find((c) => c.name.toLowerCase() === category.trim().toLowerCase())?.id || null;
      const result = await addMenuItemAction({ name, description, price, categoryId });
      setSaving(false);
      if (!result.success) { setError(result.error || "Could not add item."); return; }
      setName(""); setDescription(""); setPrice("");
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

  return (
    <Tabs defaultValue="items">
      <TabsList>
        <TabsTrigger value="items">Menu items</TabsTrigger>
        <TabsTrigger value="addons"><Tags className="h-3.5 w-3.5" /> Add-ons library</TabsTrigger>
        <TabsTrigger value="import"><Globe className="h-3.5 w-3.5" /> Import</TabsTrigger>
      </TabsList>

      <TabsContent value="items">
        <Card className="mb-4">
          <CardHeader><CardTitle>Add a menu item</CardTitle><CardDescription>Your AI only offers items and prices listed here — never invented.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {error && <div className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{error}</div>}
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>Name</Label><Input className="mt-1.5" value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div><Label>Price ($)</Label><Input type="number" step="0.01" className="mt-1.5" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
              <div className="sm:col-span-2"><Label>Description</Label><Input className="mt-1.5" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
              <div><Label>Category</Label><Input className="mt-1.5" list="menu-categories" placeholder="e.g. Burgers" value={category} onChange={(e) => setCategory(e.target.value)} />
                <datalist id="menu-categories">{categories.map((c) => <option key={c.id} value={c.name} />)}</datalist>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={addItem} disabled={saving}><Plus className="h-3.5 w-3.5" /> Add item</Button>
          </CardContent>
        </Card>

        {items.length === 0 ? (
          <EmptyState icon={UtensilsCrossed} title="No menu items yet" description="Add your first item above, or import your whole menu from a website or photo." />
        ) : (
          <>
            <div className="relative mb-4 max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search the menu…"
                className="h-9 w-full rounded-lg border border-border bg-paper pl-8 pr-3 text-[13px]"
              />
            </div>

            {totalVisible === 0 ? (
              <p className="py-8 text-center text-[13px] text-text-muted">No items match "{search}".</p>
            ) : (
              <div className="space-y-6">
                {groupedItems.map((group) => (
                  <div key={group.key}>
                    <h3 className="mb-2 font-display text-[14px] font-semibold text-ink">{group.name}</h3>
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
          </>
        )}
      </TabsContent>

      <TabsContent value="addons">
        <AddonLibraryPanel templates={addonTemplates} setTemplates={setAddonTemplates} onRefresh={refresh} />
      </TabsContent>

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
              </div>
              <div className="text-[12px] text-text-muted">{item.description}</div>
            </div>
          </button>
          <div className="flex items-center gap-3">
            <div className="font-mono text-[12.5px] text-text">${(item.price_cents / 100).toFixed(2)}</div>
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
                  <Button size="sm" variant="outline" onClick={attachTemplate} disabled={!selectedTemplateId || attaching}>{attaching ? "Attaching…" : "Attach"}</Button>
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
                  <Button size="sm" variant="outline" onClick={saveGroup} disabled={savingGroup}>{savingGroup ? "Saving…" : "Save group"}</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AddonLibraryPanel({ templates, setTemplates, onRefresh }: {
  templates: AddonTemplate[];
  setTemplates: (updater: (prev: AddonTemplate[]) => AddonTemplate[]) => void;
  onRefresh: () => void;
}) {
  const [, startTransition] = useTransition();

  // New template form
  const [name, setName] = useState("");
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState([{ name: "", priceDelta: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function addOptionRow() {
    setOptions((prev) => [...prev, { name: "", priceDelta: "" }]);
  }

  function createTemplate() {
    if (!name.trim()) { setError("Name is required."); return; }
    setSaving(true);
    setError(null);
    startTransition(async () => {
      const result = await createAddonTemplateAction({ name, required, minSelect: required ? 1 : 0, maxSelect: 1, options });
      setSaving(false);
      if (!result.success) { setError(result.error || "Could not create add-on group."); return; }
      setName(""); setRequired(false); setOptions([{ name: "", priceDelta: "" }]);
      onRefresh();
    });
  }

  function removeTemplate(templateId: string) {
    setTemplates((prev) => prev.filter((t) => t.id !== templateId));
    startTransition(async () => { await deleteAddonTemplateAction(templateId); onRefresh(); });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Your add-on groups</CardTitle>
          <CardDescription>Reusable add-ons like "Size" or "Toppings" — attach any of these to as many menu items as you want from the Menu items tab. Edit one here and it updates everywhere it's attached.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && <div className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{error}</div>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>Name</Label><Input className="mt-1.5" placeholder="e.g. Toppings" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <label className="mt-6 flex items-center gap-2 text-[12.5px] text-text-muted"><Switch checked={required} onCheckedChange={setRequired} /> Required when attached</label>
          </div>
          <div className="space-y-1.5">
            {options.map((opt, i) => (
              <div key={i} className="flex gap-2">
                <Input placeholder="Option name, e.g. Cheese" value={opt.name} onChange={(e) => setOptions((prev) => prev.map((o, idx) => (idx === i ? { ...o, name: e.target.value } : o)))} />
                <Input placeholder="+$ (optional)" className="w-28" value={opt.priceDelta} onChange={(e) => setOptions((prev) => prev.map((o, idx) => (idx === i ? { ...o, priceDelta: e.target.value } : o)))} />
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={addOptionRow}><Plus className="h-3.5 w-3.5" /> Add option</Button>
            <Button variant="brand" size="sm" onClick={createTemplate} disabled={saving}>{saving ? "Creating…" : "Create add-on group"}</Button>
          </div>
        </CardContent>
      </Card>

      {templates.length === 0 ? (
        <EmptyState icon={Tags} title="No add-on groups yet" description="Create one above — then attach it to any menu item from the Menu items tab." />
      ) : (
        <div className="space-y-2.5">
          {templates.map((template) => (
            <AddonTemplateRow key={template.id} template={template} onRemove={removeTemplate} onRefresh={onRefresh} />
          ))}
        </div>
      )}
    </div>
  );
}

function AddonTemplateRow({ template, onRemove, onRefresh }: {
  template: AddonTemplate;
  onRemove: (id: string) => void;
  onRefresh: () => void;
}) {
  const [, startTransition] = useTransition();
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(template.name);
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

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-4">
          {renaming ? (
            <div className="flex flex-1 items-center gap-2">
              <Input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} className="h-8 max-w-xs" autoFocus />
              <Button size="sm" variant="outline" onClick={saveRename}>Save</Button>
            </div>
          ) : (
            <button className="flex items-center gap-1.5 text-[13.5px] font-medium text-text hover:text-brand-dark" onClick={() => { setNameDraft(template.name); setRenaming(true); }}>
              {template.name}{template.is_required ? <span className="text-[11px] font-normal text-text-faint">(required)</span> : null}
              <Pencil className="h-3 w-3 text-text-faint" />
            </button>
          )}
          <button onClick={() => onRemove(template.id)} className="rounded-md p-1 text-text-faint hover:bg-danger-soft hover:text-danger" aria-label="Delete add-on group"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>

        <div className="mt-3 space-y-1.5">
          {template.modifiers.map((m) => (
            <div key={m.id} className="flex items-center justify-between rounded-lg bg-paper px-3 py-1.5 text-[12.5px] text-text">
              <span>{m.name}{m.price_delta_cents ? ` (+$${(m.price_delta_cents / 100).toFixed(2)})` : ""}</span>
              <button onClick={() => removeOption(m.id)} className="rounded-md p-1 text-text-faint hover:bg-danger-soft hover:text-danger"><Trash2 className="h-3 w-3" /></button>
            </div>
          ))}
        </div>

        <div className="mt-2 flex gap-2">
          <Input placeholder="Add an option, e.g. Bacon" className="h-8" value={newOptionName} onChange={(e) => setNewOptionName(e.target.value)} />
          <Input placeholder="+$" className="h-8 w-24" value={newOptionPrice} onChange={(e) => setNewOptionPrice(e.target.value)} />
          <Button size="sm" variant="ghost" onClick={addOption}><Plus className="h-3.5 w-3.5" /></Button>
        </div>
      </CardContent>
    </Card>
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
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Globe className="h-4 w-4 text-text-faint" /> Import from your website</CardTitle><CardDescription>Reads your website's real menu text — nothing is invented. Won't work on an online-ordering page (Toast, ChowNow, etc.) — use "Paste menu text" below for those instead.</CardDescription></CardHeader>
        <CardContent className="flex gap-2">
          <Input placeholder="yourrestaurant.com/menu" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} />
          <Button variant="brand" onClick={fromWebsite} disabled={importing || !websiteUrl.trim()}>{importing ? "Reading…" : "Import"}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><ClipboardPaste className="h-4 w-4 text-brand" /> Paste menu text</CardTitle><CardDescription>Open your menu page in your own browser (this works for any site, including online-ordering pages that "Import from your website" can't read), select all the text — click into individual items first if you want their addons included — and paste it here.</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          <Textarea value={pastedText} onChange={(e) => setPastedText(e.target.value)} placeholder="Paste your menu text here…" className="min-h-[120px]" />
          <Button variant="brand" size="sm" onClick={fromText} disabled={importing || pastedText.trim().length < 20}>{importing ? "Reading…" : "Import from pasted text"}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Camera className="h-4 w-4 text-brand" /> Import from a photo</CardTitle><CardDescription>Take a picture of a printed menu, price list, or PDF page you've exported as an image.</CardDescription></CardHeader>
        <CardContent>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={fromPhoto} className="hidden" />
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={importing}>
            {importing ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading…</> : <><Camera className="h-3.5 w-3.5" /> Take or upload a photo</>}
          </Button>
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
