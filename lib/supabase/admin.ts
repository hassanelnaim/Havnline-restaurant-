import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Admin (service role) Supabase client — SERVER-ONLY. Bypasses RLS.
 * Used for server actions that have already verified the caller's
 * identity via the normal cookie-based session, and now need to
 * perform writes/reads on that verified user's behalf.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY (and NEXT_PUBLIC_SUPABASE_URL) must be set to use the admin client.");
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: fetchWithTimeout },
  });
}

/**
 * No database request may hang. Without a limit, one stalled query held a
 * caller in silence until Twilio gave up on the turn. 8 seconds is far
 * above a normal query (milliseconds) and below Twilio's 15-second limit.
 * A request that already carries its own abort signal keeps it too.
 */
const DB_REQUEST_TIMEOUT_MS = 8000;

const fetchWithTimeout: typeof fetch = (input, init = {}) => {
  const timeout = AbortSignal.timeout(DB_REQUEST_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
};
