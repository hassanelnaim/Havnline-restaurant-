"use client";
import { useRouter } from "next/navigation";
import { UtensilsCrossed } from "lucide-react";
import { StepShell } from "@/components/onboarding/step-shell";
import { Card } from "@/components/ui/card";

export default function SpotOnStep() {
  const router = useRouter();

  return (
    <StepShell
      title="Connect SpotOn"
      description="This is what lets an order your AI takes on the phone actually reach your kitchen printer — the same way your existing online orders already do."
      backHref="/onboarding/voice"
      onContinue={() => router.push("/onboarding/complete")}
      continueLabel="I'll connect this later"
    >
      <Card className="flex items-start gap-3 p-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-dark"><UtensilsCrossed className="h-5 w-5" /></div>
        <div>
          <div className="text-[13.5px] font-semibold text-ink">Connect after you finish setup</div>
          <p className="mt-1 text-[12.5px] text-text-muted">
            SpotOn connects to a specific business account, so we'll ask you to connect it from your dashboard's Integrations page right after this — it only takes a minute. Until it's connected, your AI can still take orders; you'll just need to ring them in at SpotOn manually, and your Orders page will show you exactly what to enter.
          </p>
        </div>
      </Card>
    </StepShell>
  );
}
