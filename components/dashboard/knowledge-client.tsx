"use client";
import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2, Globe, Tag, Percent, Pencil, ClipboardPaste, Lightbulb } from "lucide-react";
import type { DbKnowledgeItem, DbPromotion, KnowledgeCategory } from "@/lib/database/types";
import { addKnowledgeItemAction, updateKnowledgeItemAction, deleteKnowledgeItemAction, importWebsiteKnowledgeAction, importPastedKnowledgeAction, addPromotionAction, togglePromotionAction, deletePromotionAction } from "@/app/actions/knowledge";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/dashboard/empty-state";
import { DayPicker } from "@/components/dashboard/day-picker";
import type { PromotionPrefill } from "@/lib/analytics/promotionPrefill";
import { describeSchedule, describeDiscount } from "@/lib/business/pricing";

export function KnowledgeClient({
  initialItems,
  initialPromotions,
  menuOptions,
  initialTab,
  prefill,
}: {
  initialItems: DbKnowledgeItem[];
  initialPromotions: DbPromotion[];
  menuOptions: { id: string; name: string }[];
  initialTab?: string;
  prefill?: PromotionPrefill | null;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [, startTransition] = useTransition();
  const [isPending, setIsPending] = useState(false);

  useEffect(() => { setItems(initialItems); }, [initialItems]);

  // Knowledge item form
  const [category, setCategory] = useState<KnowledgeCategory>("faq");
  const [question, setQuestion] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  function addItem() {
    setIsPending(true);
    startTransition(async () => {
      await addKnowledgeItemAction({ category, question: question || undefined, title: title || undefined, content });
      setQuestion(""); setTitle(""); setContent("");
      setIsPending(false);
      router.refresh();
    });
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    startTransition(async () => { await deleteKnowledgeItemAction(id); });
  }

  // ---- Edit knowledge item dialog ----
  const [editingKnowledgeItem, setEditingKnowledgeItem] = useState<DbKnowledgeItem | null>(null);
  const [editKnowledgeTitle, setEditKnowledgeTitle] = useState("");
  const [editKnowledgeContent, setEditKnowledgeContent] = useState("");
  const [editKnowledgeError, setEditKnowledgeError] = useState<string | null>(null);
  const [editKnowledgeSaving, setEditKnowledgeSaving] = useState(false);

  function openEditKnowledge(item: DbKnowledgeItem) {
    setEditingKnowledgeItem(item);
    setEditKnowledgeTitle(item.question || item.title || "");
    setEditKnowledgeContent(item.content);
    setEditKnowledgeError(null);
  }

  function saveEditKnowledge() {
    if (!editingKnowledgeItem) return;
    setEditKnowledgeSaving(true);
    setEditKnowledgeError(null);
    startTransition(async () => {
      const result = await updateKnowledgeItemAction(editingKnowledgeItem.id, { title: editKnowledgeTitle, content: editKnowledgeContent });
      setEditKnowledgeSaving(false);
      if (!result.success) {
        setEditKnowledgeError(result.error || "Could not save changes.");
        return;
      }
      setItems((prev) => prev.map((i) => (i.id === editingKnowledgeItem.id ? { ...i, title: editKnowledgeTitle, question: i.question ? editKnowledgeTitle : i.question, content: editKnowledgeContent } : i)));
      setEditingKnowledgeItem(null);
      router.refresh();
    });
  }

  // Website import
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  function handleImport() {
    setImporting(true);
    setImportMsg(null);
    startTransition(async () => {
      const result = await importWebsiteKnowledgeAction(websiteUrl);
      setImporting(false);
      setImportMsg(result.success ? `Added ${result.itemsAdded} items.` : result.error || "Import failed.");
      if (result.success) router.refresh();
    });
  }

  // Paste-text import — fallback for pages a URL import can't read
  // (JavaScript-rendered sites without page-rendering configured, pages
  // behind a login, etc.). The owner's own browser already rendered the
  // page, so copy-pasting its text sidesteps the problem entirely.
  const [pastedKnowledgeText, setPastedKnowledgeText] = useState("");
  const [importingPasted, setImportingPasted] = useState(false);
  const [importPastedMsg, setImportPastedMsg] = useState<string | null>(null);

  function handleImportPasted() {
    setImportingPasted(true);
    setImportPastedMsg(null);
    startTransition(async () => {
      const result = await importPastedKnowledgeAction(pastedKnowledgeText);
      setImportingPasted(false);
      setImportPastedMsg(result.success ? `Added ${result.itemsAdded} items.` : result.error || "Import failed.");
      if (result.success) { setPastedKnowledgeText(""); router.refresh(); }
    });
  }

  // Promotions
  const [promotions, setPromotions] = useState(initialPromotions);
  const [promoTitle, setPromoTitle] = useState(prefill?.title ?? "");
  const [promoDescription, setPromoDescription] = useState(prefill?.description ?? "");
  const [promoAppliesTo, setPromoAppliesTo] = useState(prefill?.appliesTo ?? "");
  const [promoStart, setPromoStart] = useState(prefill?.start ?? "");
  const [promoEnd, setPromoEnd] = useState(prefill?.end ?? "");
  const [promoDays, setPromoDays] = useState<number[]>(prefill?.days ?? []);
  const [promoStartTime, setPromoStartTime] = useState("");
  const [promoEndTime, setPromoEndTime] = useState("");
  const [promoDiscountType, setPromoDiscountType] = useState<"none" | "percent" | "amount">(prefill?.discountType ?? "none");
  const [promoDiscountValue, setPromoDiscountValue] = useState(prefill?.discountValue ?? "");
  // Only items still on the menu: an idea may name one that was removed since.
  const [promoItemIds, setPromoItemIds] = useState<string[]>((prefill?.itemIds ?? []).filter((id) => menuOptions.some((m) => m.id === id)));
  const [showPrefillNote, setShowPrefillNote] = useState(Boolean(prefill));
  const [promoError, setPromoError] = useState<string | null>(null);

  useEffect(() => { setPromotions(initialPromotions); }, [initialPromotions]);

  function addPromo() {
    setPromoError(null);
    startTransition(async () => {
      const result = await addPromotionAction({
        title: promoTitle,
        description: promoDescription,
        appliesTo: promoAppliesTo,
        startDate: promoStart,
        endDate: promoEnd,
        days: promoDays,
        startTime: promoStartTime,
        endTime: promoEndTime,
        discountType: promoDiscountType,
        discountValue: promoDiscountValue,
        menuItemIds: promoItemIds,
      });
      if (!result.success) { setPromoError(result.error || "Could not add that promotion."); return; }
      setPromoTitle(""); setPromoDescription(""); setPromoAppliesTo(""); setPromoStart(""); setPromoEnd("");
      setPromoDays([]); setPromoStartTime(""); setPromoEndTime(""); setPromoDiscountType("none"); setPromoDiscountValue(""); setPromoItemIds([]); setShowPrefillNote(false);
      router.refresh();
    });
  }

  function togglePromo(id: string, active: boolean) {
    setPromotions((prev) => prev.map((p) => (p.id === id ? { ...p, is_active: active } : p)));
    startTransition(async () => { await togglePromotionAction(id, active); });
  }

  function removePromo(id: string) {
    setPromotions((prev) => prev.filter((p) => p.id !== id));
    startTransition(async () => { await deletePromotionAction(id); });
  }

  const policies = items.filter((i) => i.category === "policy");

  return (
    <Tabs defaultValue={initialTab ?? "faqs"}>
      <TabsList className="flex-wrap">
        <TabsTrigger value="faqs">FAQs</TabsTrigger>
        <TabsTrigger value="promotions"><Percent className="h-3.5 w-3.5" /> Promotions</TabsTrigger>
        <TabsTrigger value="policies">Policies</TabsTrigger>
        <TabsTrigger value="import"><Globe className="h-3.5 w-3.5" /> Import</TabsTrigger>
      </TabsList>

      <TabsContent value="faqs">
        <Card className="mb-4">
          <CardHeader><CardTitle>Add knowledge</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Category</Label>
              <select className="mt-1.5 flex h-9 w-full rounded-lg border border-border bg-card px-3 text-[13.5px] text-text" value={category} onChange={(e) => setCategory(e.target.value as KnowledgeCategory)}>
                <option value="faq">FAQ</option>
                <option value="business_info">Business info</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            {category === "faq" ? (
              <div><Label>Question</Label><Input className="mt-1.5" value={question} onChange={(e) => setQuestion(e.target.value)} /></div>
            ) : (
              <div><Label>Title</Label><Input className="mt-1.5" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
            )}
            <div><Label>Content</Label><Textarea rows={3} className="mt-1.5" value={content} onChange={(e) => setContent(e.target.value)} /></div>
            <Button variant="brand" size="sm" onClick={addItem} disabled={isPending || !content.trim()}><Plus className="h-3.5 w-3.5" /> Add</Button>
          </CardContent>
        </Card>
        {items.filter((i) => i.category !== "policy").length === 0 ? (
          <EmptyState icon={Tag} title="No knowledge yet" description="Add FAQs and info above, or import from your website." />
        ) : (
          <div className="space-y-2">
            {items.filter((i) => i.category !== "policy").map((item) => (
              <Card key={item.id}><CardContent className="flex items-start justify-between gap-4 p-4">
                <div><div className="text-[13.5px] font-medium text-text">{item.question || item.title}</div><p className="mt-1 text-[12.5px] text-text-muted">{item.content}</p></div>
                <div className="flex items-center gap-2">
                  <button onClick={() => openEditKnowledge(item)} className="rounded-md p-1 text-text-faint hover:bg-brand-soft hover:text-brand" aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                  <button onClick={() => removeItem(item.id)} className="rounded-md p-1 text-text-faint hover:bg-danger-soft hover:text-danger" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </CardContent></Card>
            ))}
          </div>
        )}
      </TabsContent>

      <TabsContent value="promotions">
        <p className="mb-4 text-[12.5px] text-text-muted">
          A promotion runs between its start and end dates, on the days and hours you choose, and can take money off automatically: your AI quotes the discounted price and the order is charged at it. Leave the discount off and it&apos;s just something your AI can mention. To change an item&apos;s own price on certain days or hours (like a breakfast price), use the item&apos;s time-based price on the <Link href="/dashboard/menu" className="font-medium text-brand hover:underline">Menu</Link> page.
        </p>
        {showPrefillNote && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-brand/25 bg-brand-50 px-4 py-3 text-[13px] text-ink">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
            <div className="flex-1">Filled in from your dashboard idea. Check the dates, days and discount, change anything you like, then press <strong>Add promotion</strong>. Nothing is saved until you do.</div>
            <button onClick={() => setShowPrefillNote(false)} className="text-[12px] font-medium text-brand hover:underline">Dismiss</button>
          </div>
        )}
        <Card className="mb-4">
          <CardHeader><CardTitle>Add a promotion</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>Title</Label><Input className="mt-1.5" value={promoTitle} onChange={(e) => setPromoTitle(e.target.value)} placeholder="Taco Tuesday" /></div>
              <div><Label>Applies to (shown to the AI)</Label><Input className="mt-1.5" value={promoAppliesTo} onChange={(e) => setPromoAppliesTo(e.target.value)} placeholder="All tacos" /></div>
              <div className="sm:col-span-2"><Label>Description</Label><Input className="mt-1.5" value={promoDescription} onChange={(e) => setPromoDescription(e.target.value)} placeholder="20% off every taco, all day Tuesday" /></div>
              <div><Label>Start date</Label><Input type="date" className="mt-1.5" value={promoStart} onChange={(e) => setPromoStart(e.target.value)} /></div>
              <div><Label>End date</Label><Input type="date" className="mt-1.5" value={promoEnd} onChange={(e) => setPromoEnd(e.target.value)} /></div>
            </div>

            <div>
              <Label>Days it runs</Label>
              <div className="mt-1.5"><DayPicker value={promoDays} onChange={setPromoDays} /></div>
              <p className="mt-1 text-[11px] text-text-faint">{promoDays.length === 0 ? "No days picked: it runs every day." : describeSchedule({ days: promoDays })}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>From (optional)</Label><Input type="time" className="mt-1.5" value={promoStartTime} onChange={(e) => setPromoStartTime(e.target.value)} /></div>
              <div><Label>Until (optional)</Label><Input type="time" className="mt-1.5" value={promoEndTime} onChange={(e) => setPromoEndTime(e.target.value)} /></div>
              <p className="text-[11px] text-text-faint sm:col-span-2">Leave both times blank for all day. Times use your restaurant&apos;s timezone.</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Discount</Label>
                <select
                  className="mt-1.5 h-10 w-full rounded-lg border border-border bg-card px-3 text-[13.5px] text-text"
                  value={promoDiscountType}
                  onChange={(e) => setPromoDiscountType(e.target.value as "none" | "percent" | "amount")}
                >
                  <option value="none">No discount (just mention it)</option>
                  <option value="percent">Percent off</option>
                  <option value="amount">Dollars off each item</option>
                </select>
              </div>
              {promoDiscountType !== "none" && (
                <div>
                  <Label>{promoDiscountType === "percent" ? "Percent off" : "Dollars off each item"}</Label>
                  <Input className="mt-1.5" inputMode="decimal" value={promoDiscountValue} onChange={(e) => setPromoDiscountValue(e.target.value)} placeholder={promoDiscountType === "percent" ? "20" : "2.00"} />
                </div>
              )}
            </div>
            {promoDiscountType !== "none" && (
              <div>
                <Label>Which items</Label>
                <p className="mt-0.5 text-[11px] text-text-faint">{promoItemIds.length === 0 ? "No items picked: it applies to every item on the menu." : `${promoItemIds.length} item${promoItemIds.length === 1 ? "" : "s"} picked.`}</p>
                <div className="mt-1.5 max-h-40 overflow-y-auto rounded-lg border border-border p-2">
                  {menuOptions.length === 0 ? (
                    <p className="text-[12px] text-text-faint">Add menu items first.</p>
                  ) : (
                    menuOptions.map((m) => (
                      <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-paper">
                        <input
                          type="checkbox"
                          checked={promoItemIds.includes(m.id)}
                          onChange={(e) => setPromoItemIds((prev) => (e.target.checked ? [...prev, m.id] : prev.filter((x) => x !== m.id)))}
                        />
                        {m.name}
                      </label>
                    ))
                  )}
                </div>
                <p className="mt-1 text-[11px] text-text-faint">Applies to the item&apos;s price, not add-ons. If more than one promotion fits an item, the lowest price wins; they don&apos;t stack.</p>
              </div>
            )}

            {promoError && <div className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{promoError}</div>}
            <Button variant="brand" size="sm" onClick={addPromo} disabled={!promoTitle.trim() || !promoStart || !promoEnd}><Plus className="h-3.5 w-3.5" /> Add promotion</Button>
          </CardContent>
        </Card>
        {promotions.length === 0 ? (
          <EmptyState icon={Percent} title="No promotions" description="Add one above so your AI can offer it." />
        ) : (
          <div className="space-y-2.5">
            {promotions.map((p) => {
              const discount = describeDiscount(p);
              const schedule = describeSchedule({ days: p.days_of_week, start: p.start_time, end: p.end_time });
              return (
                <Card key={p.id}><CardContent className="flex items-center justify-between gap-4 p-4">
                  <div>
                    <div className="text-[13.5px] font-medium text-text">{p.title}{discount && <span className="ml-2 rounded-md bg-brand-soft px-1.5 py-0.5 text-[11px] font-semibold text-brand-dark">{discount}</span>}</div>
                    <div className="text-[12px] text-text-muted">{p.description}</div>
                    <div className="text-[12px] text-text-faint">{p.start_date} to {p.end_date} · {schedule}{p.menu_item_ids && p.menu_item_ids.length > 0 ? ` · ${p.menu_item_ids.length} item${p.menu_item_ids.length === 1 ? "" : "s"}` : discount ? " · all items" : ""}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch checked={p.is_active} onCheckedChange={(checked) => togglePromo(p.id, checked)} />
                    <button onClick={() => removePromo(p.id)} className="rounded-md p-1 text-text-faint hover:bg-danger-soft hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </CardContent></Card>
              );
            })}
          </div>
        )}
      </TabsContent>

      <TabsContent value="policies">
        {policies.length === 0 ? (
          <EmptyState icon={Tag} title="No policies yet" description="Add policies from the FAQs tab (category: Custom) or import from your website." />
        ) : (
          <div className="space-y-2">
            {policies.map((item) => (
              <Card key={item.id}><CardContent className="p-4"><div className="text-[13.5px] font-medium text-text">{item.title}</div><p className="mt-1 text-[12.5px] text-text-muted">{item.content}</p></CardContent></Card>
            ))}
          </div>
        )}
      </TabsContent>

      <TabsContent value="import">
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Globe className="h-4 w-4 text-text-faint" /> Import knowledge from your website</CardTitle><CardDescription>Let HavnLine read your website and automatically pull in FAQs and business info. To import your menu specifically, use the Menu page instead — it has its own website and photo import built for real, orderable items. If your site is a JavaScript-based app (an online ordering page, a Squarespace/Wix site, etc.) and this comes back empty, use "Paste text" below instead.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {importMsg && <div className="rounded-lg border border-border bg-paper px-3.5 py-2.5 text-[12.5px] text-text-muted">{importMsg}</div>}
              <div className="flex gap-2">
                <Input placeholder="yourbusiness.com" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} />
                <Button variant="brand" onClick={handleImport} disabled={importing || !websiteUrl.trim()}>{importing ? "Reading…" : "Import"}</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><ClipboardPaste className="h-4 w-4 text-text-faint" /> Paste text</CardTitle><CardDescription>Open the page in your own browser, select and copy the text (FAQs, hours, policies, anything useful), and paste it here. This always works, even on pages the website import above can't read.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {importPastedMsg && <div className="rounded-lg border border-border bg-paper px-3.5 py-2.5 text-[12.5px] text-text-muted">{importPastedMsg}</div>}
              <Textarea rows={6} placeholder="Paste text from your website here…" value={pastedKnowledgeText} onChange={(e) => setPastedKnowledgeText(e.target.value)} />
              <Button variant="brand" onClick={handleImportPasted} disabled={importingPasted || !pastedKnowledgeText.trim()}>{importingPasted ? "Reading…" : "Import from text"}</Button>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <Dialog open={editingKnowledgeItem !== null} onOpenChange={(open) => !open && setEditingKnowledgeItem(null)}>
        <DialogContent>
          <DialogTitle className="font-display text-[17px] font-semibold text-ink">Edit knowledge item</DialogTitle>
          <DialogDescription className="mt-1 text-[13px] text-text-muted">Changes take effect immediately — this is exactly what your AI knows and says.</DialogDescription>

          <div className="mt-5 space-y-4">
            {editKnowledgeError && <div className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{editKnowledgeError}</div>}
            <div><Label>Title</Label><Input className="mt-1.5" value={editKnowledgeTitle} onChange={(e) => setEditKnowledgeTitle(e.target.value)} /></div>
            <div><Label>Content</Label><Textarea rows={4} className="mt-1.5" value={editKnowledgeContent} onChange={(e) => setEditKnowledgeContent(e.target.value)} /></div>
            <div className="flex gap-2">
              <Button variant="brand" onClick={saveEditKnowledge} disabled={editKnowledgeSaving || !editKnowledgeContent.trim()}>{editKnowledgeSaving ? "Saving…" : "Save changes"}</Button>
              <Button variant="outline" onClick={() => setEditingKnowledgeItem(null)} disabled={editKnowledgeSaving}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
