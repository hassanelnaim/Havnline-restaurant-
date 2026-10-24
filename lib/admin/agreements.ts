import { createAdminClient } from "@/lib/supabase/admin";

export interface MemberAgreement {
  userId: string;
  email: string | null;
  role: string;
  termsVersion: string | null;
  privacyVersion: string | null;
  acceptedAt: string | null;
}

/** Which Terms each member of a business accepted at signup (migration 040). */
export async function getBusinessAgreements(businessId: string): Promise<{ members: MemberAgreement[]; available: boolean }> {
  const admin = createAdminClient();
  const { data: members } = await admin.from("business_members").select("user_id, role").eq("business_id", businessId);
  const ids = (members || []).map((m) => m.user_id);
  if (ids.length === 0) return { members: [], available: true };
  const { data: rows, error } = await admin
    .from("terms_acceptances")
    .select("user_id, email, terms_version, privacy_version, accepted_at")
    .in("user_id", ids)
    .order("accepted_at", { ascending: false });
  const latest = new Map<string, { email: string | null; terms_version: string; privacy_version: string; accepted_at: string }>();
  for (const r of rows || []) if (!latest.has(r.user_id)) latest.set(r.user_id, r);
  return {
    available: !error,
    members: (members || []).map((m) => {
      const a = latest.get(m.user_id);
      return {
        userId: m.user_id,
        email: a?.email ?? null,
        role: m.role,
        termsVersion: a?.terms_version ?? null,
        privacyVersion: a?.privacy_version ?? null,
        acceptedAt: a?.accepted_at ?? null,
      };
    }),
  };
}
