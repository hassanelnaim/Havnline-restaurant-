"use client";
import { useRouter } from "next/navigation";
import { useOnboarding } from "@/lib/onboarding/context";
import { StepShell } from "@/components/onboarding/step-shell";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";

const WEEKDAY_LABELS: Record<string, string> = { monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday" };

export default function HoursStep() {
  const router = useRouter();
  const { draft, update } = useOnboarding();

  function setDay(index: number, patch: Partial<typeof draft.hours[number]>) {
    const next = [...draft.hours];
    next[index] = { ...next[index], ...patch };
    update({ hours: next });
  }

  return (
    <StepShell title="What are your hours?" description="Your AI will only take pickup orders during these hours." backHref="/onboarding/business-info" onContinue={() => router.push("/onboarding/menu")}>
      <div className="divide-y divide-border-soft rounded-2xl border border-border bg-card">
        {draft.hours.map((day, i) => (
          <div key={day.weekday} className="flex flex-wrap items-center gap-4 px-4 py-3.5">
            <div className="flex w-32 items-center gap-2.5">
              <Switch checked={day.isOpen} onCheckedChange={(checked) => setDay(i, { isOpen: checked })} />
              <span className="text-[13.5px] font-medium text-text">{WEEKDAY_LABELS[day.weekday]}</span>
            </div>
            {day.isOpen ? (
              <div className="flex flex-1 items-center gap-2">
                <Input type="time" className="w-32" value={day.openTime} onChange={(e) => setDay(i, { openTime: e.target.value })} />
                <span className="text-[12.5px] text-text-faint">to</span>
                <Input type="time" className="w-32" value={day.closeTime} onChange={(e) => setDay(i, { closeTime: e.target.value })} />
              </div>
            ) : <span className="flex-1 text-[13px] text-text-faint">Closed</span>}
          </div>
        ))}
      </div>
    </StepShell>
  );
}
