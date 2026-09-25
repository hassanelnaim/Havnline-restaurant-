import { getBusiness } from "@/lib/data/business";
import { PageHeader } from "@/components/dashboard/page-header";
import { TestReceptionistClient } from "@/components/dashboard/test-receptionist-client";

export const dynamic = "force-dynamic";

export default async function TestReceptionistPage() {
  const business = await getBusiness();
  return (
    <div>
      <PageHeader title="Test Order-Taker" description={`Preview exactly how ${business.name}'s AI will sound to real callers.`} />
      <TestReceptionistClient />
    </div>
  );
}
