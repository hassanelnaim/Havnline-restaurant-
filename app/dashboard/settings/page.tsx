import { getBusiness, getBusinessHours } from "@/lib/data/business";
import { getCurrentUserProfile } from "@/lib/data/profile";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { hasMoneyPinSet } from "@/lib/security/moneyPin";
import { PageHeader } from "@/components/dashboard/page-header";
import { SettingsClient } from "@/components/dashboard/settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [business, profile, hours, businessId] = await Promise.all([
    getBusiness(),
    getCurrentUserProfile(),
    getBusinessHours(),
    getCurrentBusinessId(),
  ]);
  const moneyPinSet = businessId ? await hasMoneyPinSet(businessId) : false;
  return (
    <div>
      <PageHeader title="Settings" description="Manage your business profile, account, and preferences." />
      <SettingsClient business={business} profile={profile} hours={hours} moneyPinSet={moneyPinSet} />
    </div>
  );
}
