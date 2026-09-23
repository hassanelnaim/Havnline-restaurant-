"use client";
import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Globe, Camera, Loader2, UtensilsCrossed, ChevronDown, ChevronUp, CheckCircle2 } from "lucide-react";
import type { DbMenuCategory, MenuItemWithModifiers } from "@/lib/database/types";
import { addMenuItemAction, updateMenuItemAction, deleteMenuItemAction, toggleMenuItemActiveAction, addModifierGroupAction, deleteModifierGroupAction, extractMenuFromWebsiteAction, extractMenuFromImageAction, importMenuItemsAction } from "@/app/actions/menu";
import type { ExtractedMenuItem } from "@/lib/ai/websiteImport";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/dashboard/empty-state";

export function MenuClient({ initialCategories, initialItems, spotonConnected }: { initialCategories: DbMenuCategory[]; initialItems: MenuItemWithModifiers[]; spotonConnected: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [categories] = useState(initialCategories);
  const [, startTransition] = useTransition();

  // Add item form
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
      router.refresh();
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

  return (
    <Tabs defaultValue="items">
      <TabsList>
        <TabsTrigger value="items">Menu items</TabsTrigger>
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

        {!spotonConnected && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12.5px] text-amber-800">
            SpotOn isn't connected yet, so orders your AI takes will need to be rung in manually. Connect it in Integrations to send orders straight to your kitchen printer.
          </div>
        )}

        {items.length === 0 ? (
          <EmptyState icon={UtensilsCrossed} title="No menu items yet" description="Add your first item above, or import your whole menu from a website or photo." />
        ) : (
          <div className="space-y-2.5">
            {items.map((item) => (
              <MenuItemRow key={item.id} item={item} spotonConnected={spotonConnected} onToggle={toggleActive} onRemove={removeItem} onRefresh={() => router.refresh()} />
            ))}
          </div>
        )}
      </TabsContent>

      <TabsContent value="import">
        <MenuImportPanel onImported={() => router.refresh()} />
      </TabsContent>
    </Tabs>
  );
}

function MenuItemRow({ item, spotonConnected, onToggle, onRemove, onRefresh }: {
  item: MenuItemWithModifiers;
  spotonConnected: boolean;
  onToggle: (id: string, active: boolean) => void;
  onRemove: (id: string) => void;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [, startTransition] = useTransition();

  // Add modifier group form
  const [groupName, setGroupName] = useState("");
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState([{ name: "", priceDelta: "" }]);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [savingGroup, setSavingGroup] = useState(false);

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
      setGroupName(""); setRequired(false); setOptions([{ name: "", priceDelta: "" }]);
      onRefresh();
    });
  }

  function removeGroup(groupId: string) {
    startTransition(async () => { await deleteModifierGroupAction(groupId); onRefresh(); });
  }

  const isOrderable = spotonConnected ? Boolean(item.spoton_item_id) : true;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-4">
          <button className="flex flex-1 items-center gap-2 text-left" onClick={() => setExpanded((e) => !e)}>
            {expanded ? <ChevronUp className="h-3.5 w-3.5 text-text-faint" /> : <ChevronDown className="h-3.5 w-3.5 text-text-faint" />}
            <div>
              <div className="flex items-center gap-2 text-[13.5px] font-medium text-text">
                {item.name}
                {!isOrderable && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-medium text-amber-700">Not mapped to SpotOn yet</span>}
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
                  <span className="font-medium">{group.name}</span>{group.is_required ? " (required)" : ""}: {group.modifiers.map((m) => `${m.name}${m.price_delta_cents ? ` (+$${(m.price_delta_cents / 100).toFixed(2)})` : ""}`).join(", ")}
                </div>
                <button onClick={() => removeGroup(group.id)} className="rounded-md p-1 text-text-faint hover:bg-danger-soft hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}

            <div className="rounded-lg border border-border p-3">
              <div className="text-[12.5px] font-medium text-text">Add an add-on group</div>
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MenuImportPanel({ onImported }: { onImported: () => void }) {
  const [, startTransition] = useTransition();
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [staged, setStaged] = useState<ExtractedMenuItem[] | null>(null);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
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

  async function fromPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportError(null);
    setStaged(null);
    setCommitted(false);
    try {
      const base64 = await fileToBase64(file);
      const mediaType = (file.type === "image/png" ? "image/png" : file.type === "image/webp" ? "image/webp" : "image/jpeg") as "image/jpeg" | "image/png" | "image/webp";
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
        <CardHeader><CardTitle className="flex items-center gap-2"><Globe className="h-4 w-4 text-text-faint" /> Import from your website</CardTitle><CardDescription>Reads your website's real menu text — nothing is invented.</CardDescription></CardHeader>
        <CardContent className="flex gap-2">
          <Input placeholder="yourrestaurant.com/menu" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} />
          <Button variant="brand" onClick={fromWebsite} disabled={importing || !websiteUrl.trim()}>{importing ? "Reading…" : "Import"}</Button>
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
