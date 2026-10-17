"use client";
import { useState, useEffect, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, CheckCircle2, ClipboardPaste, Globe, Loader2, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import type { DbKnowledgeItem, KnowledgeCategory } from "@/lib/database/types";
import { addKnowledgeItemAction, updateKnowledgeItemAction, deleteKnowledgeItemAction, importWebsiteKnowledgeAction, importPastedKnowledgeAction } from "@/app/actions/knowledge";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

// The kinds of entry an owner can add. "custom" is shown as "Other".
const TYPES: { value: KnowledgeCategory; label: string; titleLabel: string; titlePlaceholder: string; contentPlaceholder: string }[] = [
  { value: "faq", label: "FAQ", titleLabel: "Question", titlePlaceholder: "e.g. Do you deliver?", contentPlaceholder: "e.g. We're pickup only, but you can order through DoorDash." },
  { value: "policy", label: "Policy", titleLabel: "Policy name", titlePlaceholder: "e.g. Refunds", contentPlaceholder: "e.g. If something's wrong with your order, call within 24 hours and we'll make it right." },
  { value: "business_info", label: "Business info", titleLabel: "Topic", titlePlaceholder: "e.g. Parking", contentPlaceholder: "e.g. Free parking behind the building." },
  { value: "custom", label: "Other", titleLabel: "Title", titlePlaceholder: "e.g. Catering", contentPlaceholder: "Anything else your AI should know." },
];
const TYPE_LABEL: Record<string, string> = { faq: "FAQ", policy: "Policy", business_info: "Business info", custom: "Other", menu: "Menu note" };

// Questions callers commonly ask restaurants. Clicking one fills the
// question; the owner writes the answer.
const STARTER_QUESTIONS = [
  "Do you deliver?",
  "Is there parking?",
  "Do you do catering?",
  "Do you have gluten-free options?",
  "Do you have vegetarian options?",
  "Can I order for a large group?",
  "Do you take reservations?",
  "Do you have a kids' menu?",
];

const FILTERS = ["all", "faq", "policy", "business_info", "custom"] as const;

export function KnowledgeClient({ initialItems }: { initialItems: DbKnowledgeItem[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [, startTransition] = useTransition();
  useEffect(() => { setItems(initialItems); }, [initialItems]);

  // Add form
  const [type, setType] = useState<KnowledgeCategory>("faq");
  const [entryTitle, setEntryTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const typeInfo = TYPES.find((t) => t.value === type) ?? TYPES[0];

  function addItem() {
    if (!content.trim()) return;
    setSaving(true);
    startTransition(async () => {
      await addKnowledgeItemAction(
        type === "faq"
          ? { category: type, question: entryTitle || undefined, content }
          : { category: type, title: entryTitle || undefined, content }
      );
      setSaving(false);
      setAdded(entryTitle.trim() || "Entry");
      setEntryTitle(""); setContent("");
      router.refresh();
    });
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    startTransition(async () => { await deleteKnowledgeItemAction(id); });
  }

  // List: search + type filter
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const i of items) c[i.category] = (c[i.category] || 0) + 1;
    return c;
  }, [items]);
  const shown = items.filter((i) => {
    if (filter !== "all" && i.category !== filter) return false;
    const q = search.trim().toLowerCase();
    return !q || `${i.question || ""} ${i.title || ""} ${i.content}`.toLowerCase().includes(q);
  });
  const existingQuestions = new Set(items.map((i) => (i.question || i.title || "").toLowerCase()));

  // Edit dialog
  const [editing, setEditing] = useState<DbKnowledgeItem | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  function openEdit(item: DbKnowledgeItem) {
    setEditing(item);
    setEditTitle(item.question || item.title || "");
    setEditContent(item.content);
    setEditError(null);
  }

  function saveEdit() {
    if (!editing) return;
    setEditSaving(true);
    setEditError(null);
    startTransition(async () => {
      const result = await updateKnowledgeItemAction(editing.id, { title: editTitle, content: editContent });
      setEditSaving(false);
      if (!result.success) { setEditError(result.error || "Could not save changes."); return; }
      setItems((prev) => prev.map((i) => (i.id === editing.id ? { ...i, title: editTitle, question: i.question ? editTitle : i.question, content: editContent } : i)));
      setEditing(null);
      router.refresh();
    });
  }

  // Import (website or pasted text), shown on demand
  const [showImport, setShowImport] = useState(false);
  const [importMethod, setImportMethod] = useState<"website" | "paste">("website");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [pasted, setPasted] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function runImport() {
    setImporting(true);
    setImportMsg(null);
    startTransition(async () => {
      const result = importMethod === "website" ? await importWebsiteKnowledgeAction(websiteUrl) : await importPastedKnowledgeAction(pasted);
      setImporting(false);
      if (result.success) {
        setImportMsg({ ok: true, text: `Added ${result.itemsAdded} item${result.itemsAdded === 1 ? "" : "s"}. Check them on the right and edit anything that's off.` });
        setPasted("");
        router.refresh();
      } else {
        setImportMsg({ ok: false, text: result.error || "Import failed." });
      }
    });
  }

  return (
    <div className="space-y-5">
      {/* Import, on demand */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-text-muted">Menu items and prices live on the Menu page. Promotions moved there too.</p>
        <Button variant={showImport ? "outline" : "brand"} size="sm" onClick={() => setShowImport((v) => !v)}>
          {showImport ? <><X className="h-3.5 w-3.5" /> Close import</> : <><Globe className="h-3.5 w-3.5" /> Import from website</>}
        </Button>
      </div>

      {showImport && (
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              {([
                { key: "website", icon: Globe, title: "From your website", line: "Pulls FAQs, hours and policies from a page" },
                { key: "paste", icon: ClipboardPaste, title: "Paste text", line: "Works on any page, including ones the website import can't read" },
              ] as const).map((m) => {
                const selected = importMethod === m.key;
                return (
                  <button key={m.key} onClick={() => { setImportMethod(m.key); setImportMsg(null); }} className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition-all ${selected ? "border-brand bg-brand-50 ring-1 ring-brand" : "border-border bg-card hover:border-brand/40"}`}>
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${selected ? "bg-brand text-white" : "bg-brand-soft text-brand-dark"}`}><m.icon className="h-5 w-5" /></span>
                    <span><span className="block text-[14px] font-semibold text-ink">{m.title}</span><span className="mt-0.5 block text-[12px] text-text-muted">{m.line}</span></span>
                  </button>
                );
              })}
            </div>
            {importMethod === "website" ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input placeholder="yourrestaurant.com/about" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} />
                <Button variant="brand" onClick={runImport} disabled={importing || !websiteUrl.trim()}>{importing ? <><Loader2 className="h-4 w-4 animate-spin" /> Reading…</> : "Import"}</Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Textarea rows={6} placeholder="Paste your FAQ, about or policies page text here…" value={pasted} onChange={(e) => setPasted(e.target.value)} />
                <Button variant="brand" onClick={runImport} disabled={importing || !pasted.trim()}>{importing ? <><Loader2 className="h-4 w-4 animate-spin" /> Reading…</> : "Import from text"}</Button>
              </div>
            )}
            {importing && <p className="flex items-center gap-2 text-[12px] text-text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin text-brand" /> Reading — this can take up to a minute.</p>}
            {importMsg && <div className={`rounded-lg border px-3.5 py-2.5 text-[12.5px] ${importMsg.ok ? "border-success/20 bg-success-soft text-success" : "border-danger/20 bg-danger-soft text-danger"}`}>{importMsg.text}</div>}
          </CardContent>
        </Card>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Left: add */}
        <Card className="lg:sticky lg:top-20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-soft text-brand-dark"><Plus className="h-4 w-4" /></span> Teach your AI something</CardTitle>
            <CardDescription className="mt-1">It uses this to answer callers, word for word where it matters.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3.5">
            <div role="radiogroup" aria-label="Type" className="grid grid-cols-4 gap-1 rounded-lg border border-border bg-paper p-0.5">
              {TYPES.map((t) => (
                <button key={t.value} role="radio" aria-checked={type === t.value} onClick={() => setType(t.value)} className={`rounded-md px-2 py-1.5 text-[12px] font-medium transition-colors ${type === t.value ? "bg-card text-ink shadow-sm" : "text-text-muted hover:text-ink"}`}>
                  {t.label}
                </button>
              ))}
            </div>

            {added && <div className="flex items-center gap-2 rounded-lg border border-success/20 bg-success-soft px-3.5 py-2.5 text-[12.5px] text-success"><CheckCircle2 className="h-4 w-4" /> Saved. Your AI knows this now.</div>}

            <div><Label>{typeInfo.titleLabel}</Label><Input className="mt-1.5" value={entryTitle} onChange={(e) => { setEntryTitle(e.target.value); setAdded(null); }} placeholder={typeInfo.titlePlaceholder} /></div>

            {type === "faq" && (
              <div className="flex flex-wrap gap-1.5">
                {STARTER_QUESTIONS.filter((q) => !existingQuestions.has(q.toLowerCase())).slice(0, 6).map((q) => (
                  <button key={q} onClick={() => { setEntryTitle(q); setAdded(null); }} className="rounded-full border border-border bg-card px-2.5 py-0.5 text-[12px] text-text-muted hover:border-brand/40 hover:bg-brand-50 hover:text-brand-dark">{q}</button>
                ))}
              </div>
            )}

            <div><Label>{type === "faq" ? "Answer" : "Details"}</Label><Textarea rows={4} className="mt-1.5" value={content} onChange={(e) => setContent(e.target.value)} placeholder={typeInfo.contentPlaceholder} /></div>
            <Button variant="brand" className="w-full" onClick={addItem} disabled={saving || !content.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Save
            </Button>
          </CardContent>
        </Card>

        {/* Right: what it knows */}
        <Card className="min-w-0">
          <CardContent className="p-4 sm:p-5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search what your AI knows…" className="h-10 w-full rounded-lg border border-border bg-paper pl-8 pr-3 text-[13px] focus:border-brand focus:outline-none" />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {FILTERS.map((f) => {
                const selected = filter === f;
                return (
                  <button key={f} onClick={() => setFilter(f)} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors ${selected ? "border-brand bg-brand text-white" : "border-border bg-card text-text-muted hover:border-brand/40 hover:text-ink"}`}>
                    {f === "all" ? "All" : TYPE_LABEL[f]}
                    <span className={`rounded-full px-1.5 text-[11px] ${selected ? "bg-white/20" : "bg-paper text-text-faint"}`}>{counts[f] || 0}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 border-t border-border pt-4">
              {items.length === 0 ? (
                <div className="py-8 text-center">
                  <BookOpen className="mx-auto h-6 w-6 text-text-faint" />
                  <p className="mt-2 text-[13px] font-medium text-ink">Nothing here yet</p>
                  <p className="mt-0.5 text-[12.5px] text-text-muted">Add a question on the left, or import from your website.</p>
                </div>
              ) : shown.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-text-muted">Nothing matches.</p>
              ) : (
                <div className="space-y-2.5">
                  {shown.map((item) => (
                    <div key={item.id} className="group rounded-xl border border-border bg-card p-3.5 transition-colors hover:border-brand/30">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[13.5px] font-semibold text-ink">{item.question || item.title || "Untitled"}</span>
                            <span className="rounded-full bg-paper px-2 py-0.5 text-[10.5px] font-medium text-text-muted">{TYPE_LABEL[item.category] || item.category}</span>
                          </div>
                          <p className="mt-1 whitespace-pre-line text-[12.5px] leading-relaxed text-text-muted">{item.content}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button onClick={() => openEdit(item)} className="rounded-md p-1 text-text-faint hover:bg-brand-soft hover:text-brand" aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                          <button onClick={() => removeItem(item.id)} className="rounded-md p-1 text-text-faint hover:bg-danger-soft hover:text-danger" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogTitle className="font-display text-[17px] font-semibold text-ink">Edit</DialogTitle>
          <DialogDescription className="mt-1 text-[13px] text-text-muted">Changes take effect immediately — this is exactly what your AI knows and says.</DialogDescription>
          <div className="mt-5 space-y-4">
            {editError && <div className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{editError}</div>}
            <div><Label>{editing?.category === "faq" ? "Question" : "Title"}</Label><Input className="mt-1.5" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} /></div>
            <div><Label>{editing?.category === "faq" ? "Answer" : "Details"}</Label><Textarea rows={4} className="mt-1.5" value={editContent} onChange={(e) => setEditContent(e.target.value)} /></div>
            <div className="flex gap-2">
              <Button variant="brand" onClick={saveEdit} disabled={editSaving || !editContent.trim()}>{editSaving ? "Saving…" : "Save changes"}</Button>
              <Button variant="outline" onClick={() => setEditing(null)} disabled={editSaving}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
