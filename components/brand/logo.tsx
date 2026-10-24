import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("h-8 w-8", className)} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="havnline-mark-gradient" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#60A5FA" />
          <stop offset="1" stopColor="#2563EB" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="#0B1220" />
      <path d="M10 8L14 8L14 14.5L18 14.5L18 8L22 8L22 24L18 24L18 17.5L14 17.5L14 24L10 24Z" fill="url(#havnline-mark-gradient)" />
    </svg>
  );
}

export function LogoWordmark({ className, tone = "dark" }: { className?: string; tone?: "dark" | "light" }) {
  return (
    <span className={cn("font-display font-semibold tracking-tight", className)}>
      <span className={tone === "light" ? "text-white" : "text-ink"}>Havn</span>
      <span className={tone === "light" ? "text-brand-light" : "text-brand"}>Line</span>
    </span>
  );
}

export function Logo({ className, wordmarkClassName, tone = "dark" }: { className?: string; wordmarkClassName?: string; tone?: "dark" | "light" }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <LogoWordmark tone={tone} className={wordmarkClassName} />
    </span>
  );
}
