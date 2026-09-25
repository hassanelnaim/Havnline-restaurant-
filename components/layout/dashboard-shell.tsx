"use client";
import { useState } from "react";
import Link from "next/link";
import { Menu, X, ChevronDown, ChefHat } from "lucide-react";
import { SidebarNav } from "@/components/layout/sidebar";
import { AiStatusToggle } from "@/components/dashboard/ai-status-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { signOutAction } from "@/app/actions/auth";
import { LogoMark, LogoWordmark } from "@/components/brand/logo";
import { initials } from "@/lib/format";

export function DashboardShell({
  businessName, employeeName, initialStatus, userFullName, children,
}: {
  businessName: string;
  employeeName: string;
  initialStatus: "online" | "offline";
  userFullName: string;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-paper">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-ink py-6 lg:flex">
        <Link href="/dashboard" className="mb-6 flex items-center gap-2.5 px-4">
          <LogoMark className="h-8 w-8" />
          <div>
            <LogoWordmark tone="light" className="text-[14px]" />
            <div className="truncate text-[11px] text-[#8A90A0]">{businessName}</div>
          </div>
        </Link>
        <SidebarNav />
        <div className="mt-auto px-4 pt-4">
          <div className="rounded-xl bg-ink-soft p-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-dark"><ChefHat className="h-4 w-4" /></div>
              <div className="min-w-0">
                <div className="text-[10.5px] uppercase tracking-wide text-[#8A90A0]">Order-taker</div>
                <div className="truncate text-[13px] font-medium text-white">{employeeName}</div>
              </div>
            </div>
            <div className="mt-2.5"><AiStatusToggle initialStatus={initialStatus} tone="light" /></div>
          </div>
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-ink py-6">
            <div className="mb-6 flex items-center justify-between px-4">
              <Link href="/dashboard" className="flex items-center gap-2.5" onClick={() => setMobileOpen(false)}>
                <LogoMark className="h-8 w-8" />
                <LogoWordmark tone="light" className="text-[14px]" />
              </Link>
              <button onClick={() => setMobileOpen(false)} className="text-white"><X className="h-5 w-5" /></button>
            </div>
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-card px-4 py-3 lg:px-6">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen(true)} className="text-text-muted lg:hidden"><Menu className="h-5 w-5" /></button>
            <AiStatusToggle initialStatus={initialStatus} />
          </div>
          <div className="relative">
            <button onClick={() => setMenuOpen((v) => !v)} className="flex items-center gap-2">
              <Avatar className="h-7 w-7"><AvatarFallback className="text-[11px]">{initials(userFullName)}</AvatarFallback></Avatar>
              <span className="hidden text-[13px] font-medium text-text sm:block">{userFullName}</span>
              <ChevronDown className="h-3.5 w-3.5 text-text-faint" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-2 w-44 rounded-xl border border-border bg-card p-1 shadow-popover">
                <Link href="/dashboard/settings" className="block rounded-lg px-3 py-2 text-[13px] text-text hover:bg-paper" onClick={() => setMenuOpen(false)}>Edit profile</Link>
                <form action={signOutAction}>
                  <button type="submit" className="block w-full rounded-lg px-3 py-2 text-left text-[13px] text-danger hover:bg-danger-soft">Log out</button>
                </form>
              </div>
            )}
          </div>
        </header>
        <main className="p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
