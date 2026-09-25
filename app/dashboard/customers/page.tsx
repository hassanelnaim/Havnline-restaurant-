import { Users } from "lucide-react";
import { getCustomers } from "@/lib/data/customers";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { CustomersClient } from "@/components/dashboard/customers-client";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const customers = await getCustomers();

  return (
    <div>
      <PageHeader title="Customers" description="Everyone your AI order-taker has talked to." />
      {customers.length === 0 ? (
        <EmptyState icon={Users} title="No customers yet" description="Customers your AI talks to will show up here." />
      ) : (
        <CustomersClient customers={customers} />
      )}
    </div>
  );
}
