"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, HeartPulse, Building2, Server, Star, Menu, X, ArrowLeft } from "lucide-react";
import { LogoMark, LogoWordmark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin", label: "Command Center", icon: LayoutGrid },
  { href: "/admin/health", label: "Health", icon: HeartPulse },
  { href: "/admin/businesses", label: "Businesses", icon: Building2 },
  { href: "/admin/providers", label: "Providers", icon: Server },
  { href: "/admin/reviews", label: "Reviews", icon: Star },
];

function AdminNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-0.5 px-2">
      <div className="px-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#5B6472]">Platform</div>
      {NAV.map((item) => {
        const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
              active ? "bg-brand text-white" : "text-[#B8C0D0] hover:bg-white/5 hover:text-white"
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/admin" className="flex items-center gap-2.5">
      <LogoMark className="h-8 w-8" />
      <div>
        <LogoWordmark tone="light" className="text-[14px]" />
        <div className="text-[11px] text-[#8A90A0]">Platform admin</div>
      </div>
    </Link>
  );
}

function BackLink() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] font-medium text-[#8A90A0] hover:bg-white/5 hover:text-white">
      <ArrowLeft className="h-3.5 w-3.5" /> Back to my dashboard
    </Link>
  );
}

/** Same frame as the restaurant dashboard: dark sidebar on desktop, a drawer on phones. */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen bg-paper">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-ink py-6 lg:flex">
        <div className="mb-6 px-4"><Brand /></div>
        <AdminNav />
        <div className="mt-auto px-2"><BackLink /></div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-ink py-6">
            <div className="mb-6 flex items-center justify-between px-4">
              <Brand />
              <button onClick={() => setOpen(false)} className="text-white" aria-label="Close menu"><X className="h-5 w-5" /></button>
            </div>
            <AdminNav onNavigate={() => setOpen(false)} />
            <div className="mt-auto px-2"><BackLink /></div>
          </div>
        </div>
      )}

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-card px-4 py-3 lg:hidden">
          <button onClick={() => setOpen(true)} className="text-text-muted" aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          <span className="text-[13px] font-semibold text-ink">HavnLine admin</span>
        </header>
        <main className="mx-auto max-w-6xl p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
