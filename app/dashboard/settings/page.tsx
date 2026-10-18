import { getBusiness, getBusinessHours, getUpcomingClosures } from "@/lib/data/business";
import { getCurrentUserProfile } from "@/lib/data/profile";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { hasMoneyPinSet } from "@/lib/security/moneyPin";
import { safeTimezone } from "@/lib/business/timezone";
import { PageHeader } from "@/components/dashboard/page-header";
import { SettingsClient } from "@/components/dashboard/settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams?: { tab?: string } }) {
  const [business, profile, hours, businessId] = await Promise.all([
    getBusiness(),
    getCurrentUserProfile(),
    getBusinessHours(),
    getCurrentBusinessId(),
  ]);
  const timezone = safeTimezone(business.timezone);
  const [moneyPinSet, closures] = await Promise.all([
    businessId ? hasMoneyPinSet(businessId) : Promise.resolve(false),
    getUpcomingClosures(timezone),
  ]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return (
    <div className="pb-28">
      <PageHeader title="Settings" description="Your restaurant's details and hours, and your own account." />
      <SettingsClient
        business={business}
        profile={profile}
        hours={hours}
        moneyPinSet={moneyPinSet}
        closures={closures}
        today={today}
        initialTab={searchParams?.tab === "account" ? "account" : "restaurant"}
      />
    </div>
  );
}
