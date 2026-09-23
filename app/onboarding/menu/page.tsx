"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { useOnboarding } from "@/lib/onboarding/context";
import type { OnboardingMenuItemDraft } from "@/lib/onboarding/context";
import { StepShell } from "@/components/onboarding/step-shell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

function blankItem(): OnboardingMenuItemDraft {
  return { id: crypto.randomUUID(), name: "", description: "", price: "", category: "", modifierGroups: [] };
}

export default function MenuStep() {
  const router = useRouter();
  const { draft, update } = useOnboarding();
  const [items, setItems] = useState<OnboardingMenuItemDraft[]>(draft.menuItems.length ? draft.menuItems : [blankItem()]);

  function setItem(id: string, patch: Partial<OnboardingMenuItemDraft>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  function addRow() {
    setItems((prev) => [...prev, blankItem()]);
  }

  function removeRow(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function handleContinue() {
    update({ menuItems: items.filter((i) => i.name.trim()) });
    router.push("/onboarding/ai-receptionist");
  }

  return (
    <StepShell
      title="What's on your menu?"
      description="Add your real items and prices — your AI will only ever offer what's listed here. You can add add-ons/modifiers (sizes, toppings) and import your full menu from a website or photo later in your dashboard."
      backHref="/onboarding/hours"
      onContinue={handleContinue}
    >
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="grid gap-2 rounded-xl border border-border bg-card p-3 sm:grid-cols-[1.2fr,1.5fr,0.7fr,0.8fr,auto]">
            <div><Label className="sr-only">Name</Label><Input placeholder="Item name" value={item.name} onChange={(e) => setItem(item.id, { name: e.target.value })} /></div>
            <div><Label className="sr-only">Description</Label><Input placeholder="Description (optional)" value={item.description} onChange={(e) => setItem(item.id, { description: e.target.value })} /></div>
            <div><Label className="sr-only">Price</Label><Input type="number" step="0.01" placeholder="Price" value={item.price} onChange={(e) => setItem(item.id, { price: e.target.value })} /></div>
            <div><Label className="sr-only">Category</Label><Input placeholder="Category" value={item.category} onChange={(e) => setItem(item.id, { category: e.target.value })} /></div>
            <button onClick={() => removeRow(item.id)} className="justify-self-end rounded-md p-2 text-text-faint hover:bg-danger-soft hover:text-danger" aria-label="Remove item"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addRow}><Plus className="h-3.5 w-3.5" /> Add another item</Button>
      </div>
    </StepShell>
  );
}
