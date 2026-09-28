"use client";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Must match the real routes under app/onboarding/ exactly — this list
// was still describing the old generic-business flow ("Services",
// "Calendar" — an appointment-booking step) instead of this product's
// actual restaurant flow, so the progress bar was silently 7 dots for
// 6 real steps and mis-highlighted the Menu step entirely.
const STEPS = [
  { path: "/onboarding/business-info", label: "Business" },
  { path: "/onboarding/hours", label: "Hours" },
  { path: "/onboarding/menu", label: "Menu" },
  { path: "/onboarding/ai-receptionist", label: "AI" },
  { path: "/onboarding/voice", label: "Voice" },
  { path: "/onboarding/complete", label: "Go live" },
];

export function StepperNav() {
  const pathname = usePathname();
  const currentIndex = STEPS.findIndex((s) => s.path === pathname);

  return (
    <div className="mb-8 flex items-center gap-1.5">
      {STEPS.map((step, i) => (
        <div key={step.path} className={cn("h-1.5 flex-1 rounded-full", i <= currentIndex ? "bg-brand" : "bg-border-soft")} />
      ))}
    </div>
  );
}
