import { createAdminClient } from "@/lib/supabase/admin";
import type { DbBusiness, DbOrder, OrderWithItems } from "@/lib/database/types";

/**
 * SpotOn Central API integration.
 *
 * This is the piece that solves the actual problem the restaurant pivot
 * exists to solve: getting a phone-taken order to the kitchen printer.
 * SpotOn's Orders API accepts an order with a fulfillment type, and once
 * submitted it flows through SpotOn's own routing to the kitchen
 * printer — the same path their existing online orders already take.
 * We never talk to a printer directly.
 *
 * Docs: https://developers.spoton.com/central-api/docs/create-order
 *
 * IMPORTANT — this file is a real, working skeleton, not a mock. The
 * pieces that require your actual SpotOn developer credentials
 * (SPOTON_CLIENT_ID / SPOTON_CLIENT_SECRET, obtained by applying for
 * API access at https://www.spoton.com/developer-center/) are wired
 * up and ready, but nothing here has been tested against SpotOn's
 * real API yet — that can only happen once those credentials exist
 * and a real SpotOn sandbox location is connected. Treat the first
 * real connection + order submission as a test pass, not an
 * assumption that this works end to end on the first try.
 */

const SPOTON_API_BASE = process.env.SPOTON_API_BASE || "https://api.spoton.com";
const SPOTON_AUTH_BASE = process.env.SPOTON_AUTH_BASE || "https://login.spoton.com";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

// --------------------------------------------------------------------------
// OAuth connect flow — same shape as the Google Calendar integration this
// replaces: redirect the owner to SpotOn to authorize, SpotOn redirects
// back to our callback with a code, we exchange it for tokens.
// --------------------------------------------------------------------------

export function buildSpotOnAuthorizeUrl(businessId: string, redirectUri: string): string {
  const clientId = requireEnv("SPOTON_CLIENT_ID");
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "orders:write menu:read",
    // Carries the business through the redirect round-trip so the
    // callback route knows which business this connection belongs to.
    state: businessId,
  });
  return `${SPOTON_AUTH_BASE}/oauth/authorize?${params.toString()}`;
}

interface SpotOnTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  location_id?: string;
}

export async function exchangeSpotOnCode(code: string, redirectUri: string): Promise<SpotOnTokenResponse> {
  const clientId = requireEnv("SPOTON_CLIENT_ID");
  const clientSecret = requireEnv("SPOTON_CLIENT_SECRET");

  const res = await fetch(`${SPOTON_AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SpotOn token exchange failed (${res.status}): ${text}`);
  }

  return res.json();
}

async function refreshSpotOnTokenIfNeeded(business: DbBusiness): Promise<string> {
  if (!business.spoton_access_token) throw new Error("SpotOn is not connected for this business.");

  const expiresAt = business.spoton_token_expires_at ? new Date(business.spoton_token_expires_at).getTime() : 0;
  const fiveMinutesFromNow = Date.now() + 5 * 60 * 1000;

  if (expiresAt > fiveMinutesFromNow) {
    return business.spoton_access_token;
  }

  if (!business.spoton_refresh_token) throw new Error("SpotOn connection expired and cannot be refreshed — reconnect required.");

  const clientId = requireEnv("SPOTON_CLIENT_ID");
  const clientSecret = requireEnv("SPOTON_CLIENT_SECRET");

  const res = await fetch(`${SPOTON_AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: business.spoton_refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) throw new Error(`SpotOn token refresh failed (${res.status}).`);
  const tokens: SpotOnTokenResponse = await res.json();

  const admin = createAdminClient();
  await admin
    .from("businesses")
    .update({
      spoton_access_token: tokens.access_token,
      spoton_refresh_token: tokens.refresh_token || business.spoton_refresh_token,
      spoton_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    })
    .eq("id", business.id);

  return tokens.access_token;
}

// --------------------------------------------------------------------------
// Menu sync — pull the real menu from SpotOn so item IDs and prices match
// what SpotOn will actually accept on an order.
// --------------------------------------------------------------------------

interface SpotOnMenuItem {
  id: string;
  name: string;
  description?: string;
  price: number; // cents
  category_id?: string;
  category_name?: string;
  modifier_groups?: {
    id: string;
    name: string;
    required?: boolean;
    min_select?: number;
    max_select?: number;
    modifiers: { id: string; name: string; price_delta?: number }[];
  }[];
}

export async function fetchSpotOnMenu(businessId: string): Promise<SpotOnMenuItem[]> {
  const admin = createAdminClient();
  const { data: business, error } = await admin.from("businesses").select("*").eq("id", businessId).single();
  if (error || !business) throw new Error("Business not found.");
  if (!business.spoton_location_id) throw new Error("SpotOn is not connected for this business.");

  const accessToken = await refreshSpotOnTokenIfNeeded(business);

  const res = await fetch(`${SPOTON_API_BASE}/v2/locations/${business.spoton_location_id}/menu`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SpotOn menu fetch failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.items || data;
}

/**
 * Pulls the real menu from SpotOn and upserts it into menu_categories/
 * menu_items/modifier_groups/modifiers, matched on spoton_item_id so
 * repeated syncs update existing rows instead of duplicating them.
 * Manually-entered or PDF-imported items (source != "spoton_sync") are
 * left untouched — this only ever writes rows it owns.
 */
export async function syncSpotOnMenu(businessId: string): Promise<{ itemCount: number }> {
  const admin = createAdminClient();
  const spotonItems = await fetchSpotOnMenu(businessId);

  let itemCount = 0;

  for (const spotonItem of spotonItems) {
    let categoryId: string | null = null;
    if (spotonItem.category_name) {
      const { data: existingCategory } = await admin
        .from("menu_categories")
        .select("id")
        .eq("business_id", businessId)
        .eq("name", spotonItem.category_name)
        .maybeSingle();

      if (existingCategory) {
        categoryId = existingCategory.id;
      } else {
        const { data: newCategory } = await admin
          .from("menu_categories")
          .insert({ business_id: businessId, name: spotonItem.category_name })
          .select("id")
          .single();
        categoryId = newCategory?.id || null;
      }
    }

    const { data: upsertedItem, error: itemError } = await admin
      .from("menu_items")
      .upsert(
        {
          business_id: businessId,
          category_id: categoryId,
          name: spotonItem.name,
          description: spotonItem.description || null,
          price_cents: spotonItem.price,
          source: "spoton_sync",
          spoton_item_id: spotonItem.id,
        },
        { onConflict: "business_id,spoton_item_id" }
      )
      .select("id")
      .single();

    if (itemError || !upsertedItem) continue;
    itemCount += 1;

    for (const group of spotonItem.modifier_groups || []) {
      const { data: upsertedGroup } = await admin
        .from("modifier_groups")
        .upsert(
          {
            business_id: businessId,
            menu_item_id: upsertedItem.id,
            name: group.name,
            is_required: Boolean(group.required),
            min_select: group.min_select ?? 0,
            max_select: group.max_select ?? 1,
            spoton_modifier_group_id: group.id,
          },
          { onConflict: "menu_item_id,spoton_modifier_group_id" }
        )
        .select("id")
        .single();

      if (!upsertedGroup) continue;

      for (const modifier of group.modifiers) {
        await admin.from("modifiers").upsert(
          {
            business_id: businessId,
            modifier_group_id: upsertedGroup.id,
            name: modifier.name,
            price_delta_cents: modifier.price_delta || 0,
            spoton_modifier_id: modifier.id,
          },
          { onConflict: "modifier_group_id,spoton_modifier_id" }
        );
      }
    }
  }

  await admin.from("businesses").update({ spoton_menu_synced_at: new Date().toISOString() }).eq("id", businessId);

  return { itemCount };
}

// --------------------------------------------------------------------------
// Order submission — the actual hand-off to the kitchen printer, via
// SpotOn's own routing. Uses "Propose then Submit" so SpotOn computes
// real tax rather than us guessing it.
// --------------------------------------------------------------------------

export async function submitOrderToSpotOn(order: OrderWithItems): Promise<{ success: true; spotonOrderId: string; taxCents: number } | { success: false; error: string }> {
  const admin = createAdminClient();
  const { data: business, error } = await admin.from("businesses").select("*").eq("id", order.business_id).single();
  if (error || !business) return { success: false, error: "Business not found." };
  if (!business.spoton_location_id) return { success: false, error: "SpotOn is not connected for this business." };

  try {
    const accessToken = await refreshSpotOnTokenIfNeeded(business);

    const payload = {
      location_id: business.spoton_location_id,
      fulfillment_type: "PICKUP",
      customer: { name: order.customer_name || "Phone order", phone: order.phone || undefined },
      special_instructions: order.special_instructions || undefined,
      items: order.items.map((item) => ({
        item_id: item.menu_item_id,
        quantity: item.quantity,
        notes: item.notes || undefined,
        modifiers: item.modifiers.map((m) => ({ modifier_id: m.modifier_id })),
      })),
    };

    // Propose first — SpotOn validates the items/modifiers and computes
    // real tax, so we never have to guess a tax rate ourselves.
    const proposeRes = await fetch(`${SPOTON_API_BASE}/v2/orders/propose`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!proposeRes.ok) {
      const text = await proposeRes.text().catch(() => "");
      return { success: false, error: `SpotOn rejected this order (${proposeRes.status}): ${text}` };
    }

    const proposed = await proposeRes.json();

    const submitRes = await fetch(`${SPOTON_API_BASE}/v2/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ proposal_id: proposed.proposal_id }),
    });

    if (!submitRes.ok) {
      const text = await submitRes.text().catch(() => "");
      return { success: false, error: `SpotOn order submission failed (${submitRes.status}): ${text}` };
    }

    const submitted = await submitRes.json();
    return { success: true, spotonOrderId: submitted.id, taxCents: proposed.tax_cents ?? 0 };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown SpotOn error." };
  }
}
