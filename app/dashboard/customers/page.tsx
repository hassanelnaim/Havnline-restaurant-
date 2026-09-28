import { Users } from "lucide-react";
import { getCustomers } from "@/lib/data/customers";
import { getCallsByPhone } from "@/lib/data/calls";
import { getBusiness } from "@/lib/data/business";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { CustomersClient } from "@/components/dashboard/customers-client";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const [customers, callsByPhone, business] = await Promise.all([getCustomers(), getCallsByPhone(), getBusiness()]);

  return (
    <div>
      <PageHeader title="Callers" description="Everyone who's called in — block a number here if it's spam or a nuisance caller." />
      {customers.length === 0 ? (
        <EmptyState icon={Users} title="No callers yet" description="People who call in will show up here." />
      ) : (
        <CustomersClient customers={customers} callsByPhone={callsByPhone} timezone={business.timezone || "America/New_York"} />
      )}
    </div>
  );
}
