import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/fetchAll";

/**
 * Accounts that never verified their email and never set up a restaurant.
 * An unverified account can't sign in, so it can't have done anything: it
 * is either a bot sign-up or someone who gave up. The nightly cleanup
 * deletes them after UNVERIFIED_ACCOUNT_DAYS; the admin Health page lists
 * them sooner with a button to delete them now.
 */
export const UNVERIFIED_ACCOUNT_DAYS = 7;
/** Leaves a real person who just signed up time to open the link. */
export const UNVERIFIED_GRACE_HOURS = 1;
/** New accounts in a day that the nightly check emails about. */
export const SIGNUPS_PER_DAY_ALERT = 10;

export interface UnverifiedAccount {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
}

interface AuthUserLite {
  id: string;
  email?: string;
  created_at: string;
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
  user_metadata?: Record<string, unknown> | null;
}

const PER_PAGE = 1000;
const MAX_PAGES = 50;

export async function listAuthUsers(): Promise<{ users: AuthUserLite[]; error: string | null }> {
  const admin = createAdminClient();
  const users: AuthUserLite[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) return { users, error: error.message };
    const batch = (data?.users || []) as AuthUserLite[];
    users.push(...batch);
    if (batch.length < PER_PAGE) break;
  }
  return { users, error: null };
}

/** Unverified accounts with no restaurant, created more than olderThanHours ago. */
export async function findUnverifiedAccounts(olderThanHours: number): Promise<{ accounts: UnverifiedAccount[]; total: number; recent24h: number; error: string | null }> {
  const admin = createAdminClient();
  const [{ users, error }, members] = await Promise.all([
    listAuthUsers(),
    fetchAllRows<{ user_id: string }>((from, to) => admin.from("business_members").select("user_id").order("user_id").range(from, to)),
  ]);
  if (error) return { accounts: [], total: 0, recent24h: 0, error };
  if (members.error) return { accounts: [], total: users.length, recent24h: 0, error: members.error.message };

  const hasBusiness = new Set(members.data.map((m) => m.user_id));
  const adminEmail = (process.env.PLATFORM_ADMIN_EMAIL || "").toLowerCase();
  const cutoff = Date.now() - olderThanHours * 60 * 60 * 1000;
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;

  const accounts = users
    .filter((u) => !u.email_confirmed_at && !u.confirmed_at)
    .filter((u) => !hasBusiness.has(u.id))
    .filter((u) => (u.email || "").toLowerCase() !== adminEmail)
    .filter((u) => Date.parse(u.created_at) < cutoff)
    .map((u) => ({
      id: u.id,
      email: u.email || "(no email)",
      name: typeof u.user_metadata?.full_name === "string" ? (u.user_metadata.full_name as string) : null,
      createdAt: u.created_at,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return { accounts, total: users.length, recent24h: users.filter((u) => Date.parse(u.created_at) >= dayAgo).length, error: null };
}

/**
 * Deletes unverified, restaurant-less accounts older than olderThanHours.
 * Each one is re-checked just before it's deleted, so an account that
 * verified or joined a restaurant a moment ago is left alone.
 */
export async function deleteUnverifiedAccounts(olderThanHours: number): Promise<{ deleted: number; failed: number; error: string | null }> {
  const { accounts, error } = await findUnverifiedAccounts(olderThanHours);
  if (error) return { deleted: 0, failed: 0, error };
  const admin = createAdminClient();
  let deleted = 0;
  let failed = 0;
  for (const a of accounts.slice(0, 500)) {
    const { data: fresh } = await admin.auth.admin.getUserById(a.id);
    const u = fresh?.user as AuthUserLite | undefined;
    if (!u || u.email_confirmed_at || u.confirmed_at) continue;
    const { count } = await admin.from("business_members").select("user_id", { count: "exact", head: true }).eq("user_id", a.id);
    if ((count || 0) > 0) continue;
    const { error: delError } = await admin.auth.admin.deleteUser(a.id);
    if (delError) {
      failed += 1;
      console.error("[accounts] could not delete an unverified account:", delError.message);
    } else {
      deleted += 1;
    }
  }
  return { deleted, failed, error: null };
}
