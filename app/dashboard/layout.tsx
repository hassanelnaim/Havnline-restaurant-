import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { getBusiness } from "@/lib/data/business";
import { getAiReceptionist } from "@/lib/data/ai-receptionist";
import { getCurrentUserProfile } from "@/lib/data/profile";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { getCurrentBusinessId, getCurrentUser } from "@/lib/supabase/business";
import { getUnreadPlatformMessages } from "@/lib/data/platform-messages";
import { PlatformMessages } from "@/components/dashboard/platform-messages";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  if (isSupabaseConfigured()) {
    const user = await getCurrentUser();
    if (!user) redirect("/login");
    const businessId = await getCurrentBusinessId();
    if (!businessId) redirect("/onboarding");
  }

  const [business, ai, profile, messages] = await Promise.all([getBusiness(), getAiReceptionist(), getCurrentUserProfile(), getUnreadPlatformMessages()]);

  return (
    <DashboardShell businessName={business.name} initialStatus={ai.status} userFullName={profile.fullName}>
      <PlatformMessages messages={messages} />
      {children}
    </DashboardShell>
  );
}
