"use client";
import { useRouter } from "next/navigation";
import { useOnboarding } from "@/lib/onboarding/context";
import type { AiResponsibilities } from "@/lib/database/types";
import { StepShell } from "@/components/onboarding/step-shell";
import { Switch } from "@/components/ui/switch";

const RESPONSIBILITY_ITEMS: { key: keyof AiResponsibilities; label: string; hint: string }[] = [
  { key: "answer_questions", label: "Answering questions", hint: "Uses your business knowledge to respond" },
  { key: "take_orders", label: "Taking phone orders", hint: "Walks callers through the menu and places orders" },
  { key: "modify_orders", label: "Adding/removing items mid-call", hint: "Lets a customer change their order before confirming" },
  { key: "collect_customer_info", label: "Collecting customer info", hint: "Gets name and phone before placing the order" },
  { key: "escalate_to_human", label: "Escalating to a human", hint: "Hands off anything out of scope" },
];

export default function AiReceptionistStep() {
  const router = useRouter();
  const { draft, update } = useOnboarding();

  function toggleResponsibility(key: keyof AiResponsibilities) {
    update({ responsibilities: { ...draft.responsibilities, [key]: !draft.responsibilities[key] } });
  }

  return (
    <StepShell title="What should your order-taker handle?" description="Pick what it's allowed to do. You can name it, pick its voice and tone, and fine-tune everything else afterward in your dashboard." backHref="/onboarding/menu" onContinue={() => router.push("/onboarding/voice")}>
      <div className="divide-y divide-border-soft rounded-2xl border border-border bg-card">
        {RESPONSIBILITY_ITEMS.map((item) => (
          <div key={item.key} className="flex items-center justify-between gap-4 px-4 py-3.5">
            <div>
              <div className="text-[13.5px] font-medium text-text">{item.label}</div>
              <div className="text-[11.5px] text-text-muted">{item.hint}</div>
            </div>
            <Switch checked={draft.responsibilities[item.key]} onCheckedChange={() => toggleResponsibility(item.key)} />
          </div>
        ))}
      </div>
    </StepShell>
  );
}
