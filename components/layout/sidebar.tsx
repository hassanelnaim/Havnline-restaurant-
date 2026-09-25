"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Phone, ClipboardList, UtensilsCrossed, Users, Bot, MessageSquare, BookOpen, Plug, CreditCard, Settings, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_GROUPS = [
  {
    label: "Operations",
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutGrid },
      { href: "/dashboard/calls", label: "Calls", icon: Phone },
      { href: "/dashboard/orders", label: "Orders", icon: ClipboardList },
      { href: "/dashboard/menu", label: "Menu", icon: UtensilsCrossed },
      { href: "/dashboard/customers", label: "Customers", icon: Users },
      { href: "/dashboard/escalations", label: "Escalations", icon: AlertTriangle },
    ],
  },
  {
    label: "Your AI",
    items: [
      { href: "/dashboard/ai-employee", label: "AI Employee", icon: Bot },
      { href: "/dashboard/knowledge", label: "Knowledge", icon: BookOpen },
      { href: "/dashboard/test-receptionist", label: "Test Order-Taker", icon: MessageSquare },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/dashboard/integrations", label: "Integrations", icon: Plug },
      { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
      { href: "/dashboard/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-4 px-2">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <div className="px-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#5B6472]">{group.label}</div>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const active = item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href);
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
          </div>
        </div>
      ))}
    </nav>
  );
}
