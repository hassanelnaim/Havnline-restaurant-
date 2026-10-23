import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/supabase/platform-admin";
import { AdminShell } from "@/components/admin/admin-shell";

export const dynamic = "force-dynamic";

export default async function PlatformAdminLayout({ children }: { children: React.ReactNode }) {
  const allowed = await isPlatformAdmin();

  if (!allowed) {
    // Log the real diagnostic detail server-side only (visible to you
    // via Vercel's logs) — never show the configured admin email in
    // the actual page, since that's real information a non-admin
    // visitor (or an attacker) shouldn't be able to learn just by
    // navigating here.
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const configuredEmail = process.env.PLATFORM_ADMIN_EMAIL;
    console.warn(`[platform-admin] Access denied. Logged in as: ${user?.email || "no session"}. Configured admin set: ${Boolean(configuredEmail)}.`);

    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-paper px-6 text-center">
        <div className="max-w-sm rounded-2xl border border-border bg-card p-6 shadow-card">
          <h1 className="font-display text-[16px] font-semibold text-ink">Access restricted</h1>
          <p className="mt-2 text-[13px] text-text-muted">
            You don&apos;t have access to this page. If you believe this is a mistake, check the server logs for the exact reason.
          </p>
          <Link href="/dashboard" className="mt-4 inline-block text-[13px] font-medium text-brand hover:underline">Back to my dashboard</Link>
        </div>
      </div>
    );
  }

  return <AdminShell>{children}</AdminShell>;
}
