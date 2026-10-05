import { createAdminClient } from "@/lib/supabase/admin";
import { safeTimezone } from "@/lib/business/timezone";
import { getVoiceConfigForCall } from "@/lib/ai/voiceSelection";
import type {
  DbAiReceptionist, DbAiVoiceConfig, DbBusiness, DbBusinessHours,
  DbKnowledgeItem, DbPromotion, MenuItemWithModifiers,
} from "@/lib/database/types";

export interface BusinessContext {
  business: DbBusiness;
  hours: DbBusinessHours[];
  menu: MenuItemWithModifiers[];
  ai: DbAiReceptionist;
  voice: Pick<DbAiVoiceConfig, "voice_id" | "provider_voice_ref"> | null;
  knowledge: DbKnowledgeItem[];
  activePromotions: DbPromotion[];
}

// Every turn of every live call rebuilds this from ten parallel queries.
// During a rush that is the same menu being re-read from the database
// over and over for the same few businesses, which both adds latency to
// each turn and multiplies database load by the number of simultaneous
// calls. A short TTL collapses all of that: a business that is busy
// enough to matter is by definition getting several turns inside the
// window. 20 seconds is short enough that a menu edit shows up on the
// next call, long enough to absorb a burst. Concurrent turns share one
// in-flight load instead of each starting their own.
//
// Per serverless instance, not global — instances don't share memory —
// so this trims load rather than eliminating it, and stays correct by
// construction (an instance that never saw an edit just expires its
// copy within 20 seconds like any other).
const CONTEXT_CACHE_TTL_MS = 20_000;
const CONTEXT_CACHE_MAX_ENTRIES = 200;
const contextCache = new Map<string, { expiresAt: number; promise: Promise<BusinessContext | null> }>();

function pruneContextCache(now: number) {
  if (contextCache.size <= CONTEXT_CACHE_MAX_ENTRIES) return;
  for (const [key, entry] of contextCache) {
    if (entry.expiresAt <= now) contextCache.delete(key);
  }
  // Still over the cap with nothing expired: drop oldest-inserted first.
  while (contextCache.size > CONTEXT_CACHE_MAX_ENTRIES) {
    const oldest = contextCache.keys().next().value;
    if (oldest === undefined) break;
    contextCache.delete(oldest);
  }
}

/**
 * `fresh: true` skips the cache — used by the dashboard's Test
 * Receptionist so an owner who just edited their menu and immediately
 * tests it hears the change, not a copy up to 20 seconds old.
 */
export async function loadBusinessContext(
  businessId: string,
  options: { fresh?: boolean } = {}
): Promise<BusinessContext | null> {
  const now = Date.now();
  if (!options.fresh) {
    const hit = contextCache.get(businessId);
    if (hit && hit.expiresAt > now) return hit.promise;
  }

  const promise = fetchBusinessContext(businessId);
  contextCache.set(businessId, { expiresAt: now + CONTEXT_CACHE_TTL_MS, promise });
  pruneContextCache(now);

  // A failed or "business not found" load must never be remembered —
  // the next turn should try the database again.
  promise.then(
    (result) => {
      if (!result && contextCache.get(businessId)?.promise === promise) contextCache.delete(businessId);
    },
    () => {
      if (contextCache.get(businessId)?.promise === promise) contextCache.delete(businessId);
    }
  );

  return promise;
}

async function fetchBusinessContext(businessId: string): Promise<BusinessContext | null> {
  const admin = createAdminClient();

  const [businessRes, hoursRes, itemsRes, groupsRes, modifiersRes, attachmentsRes, aiRes, voice, knowledgeRes, promotionsRes] = await Promise.all([
    admin.from("businesses").select("*").eq("id", businessId).single(),
    admin.from("business_hours").select("*").eq("business_id", businessId),
    admin.from("menu_items").select("*").eq("business_id", businessId).eq("is_active", true).order("sort_order"),
    admin.from("modifier_groups").select("*").eq("business_id", businessId).order("sort_order"),
    admin.from("modifiers").select("*").eq("business_id", businessId).eq("is_active", true).order("sort_order"),
    admin.from("menu_item_modifier_groups").select("*").eq("business_id", businessId),
    admin.from("ai_receptionists").select("*").eq("business_id", businessId).single(),
    getVoiceConfigForCall(businessId, "loadBusinessContext"),
    admin.from("knowledge_items").select("*").eq("business_id", businessId),
    admin.from("promotions").select("*").eq("business_id", businessId).eq("is_active", true),
  ]);

  if (businessRes.error || !businessRes.data) return null;
  if (aiRes.error || !aiRes.data) return null;

  // Normalized once, here, so every downstream consumer of this
  // BusinessContext (the system prompt, hours/pricing checks, tool
  // handlers — the whole live-call path) can trust business.timezone
  // is always a real IANA zone, even if a bad value somehow ended up
  // in the row. A throw here would otherwise take down this business's
  // entire phone line on every single call.
  const business = { ...(businessRes.data as DbBusiness), timezone: safeTimezone(businessRes.data.timezone) };
  const groups = groupsRes.data || [];
  const allModifiers = modifiersRes.data || [];
  const attachments = attachmentsRes.data || [];

  const templateGroups = groups.filter((g) => g.is_template);
  const oneOffGroups = groups.filter((g) => !g.is_template);

  const rawItems = itemsRes.data || [];

  // Every item's modifier_groups is the merge of its own one-off groups
  // (menu_item_id set directly, unchanged from before) plus any shared
  // add-on templates attached to it via menu_item_modifier_groups — see
  // migration 017. The AI sees one combined list either way and never
  // needs to know which mechanism a given group came from.
  const menu: MenuItemWithModifiers[] = rawItems.map((item) => {
    const ownGroups = oneOffGroups.filter((g) => g.menu_item_id === item.id);
    const attachedTemplateIds = attachments.filter((a) => a.menu_item_id === item.id).map((a) => a.modifier_group_id);
    const attachedTemplates = templateGroups.filter((g) => attachedTemplateIds.includes(g.id));
    return {
      ...item,
      modifier_groups: [...ownGroups, ...attachedTemplates].map((g) => ({ ...g, modifiers: allModifiers.filter((m) => m.modifier_group_id === g.id) })),
    };
  });

  const todayInBusinessTz = new Intl.DateTimeFormat("en-CA", {
    timeZone: business.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const activePromotions = (promotionsRes.data || []).filter(
    (p) => p.start_date <= todayInBusinessTz && p.end_date >= todayInBusinessTz
  );

  return {
    business,
    hours: hoursRes.data || [],
    menu,
    ai: aiRes.data,
    voice,
    knowledge: knowledgeRes.data || [],
    activePromotions,
  };
}

export interface ResolvedBusiness {
  businessId: string;
  subAccountAuthToken: string | null;
}

export async function resolveBusinessFromPhoneNumber(dialedNumber: string): Promise<ResolvedBusiness | null> {
  const admin = createAdminClient();
  // Filtered in the database, on an indexed expression (migration 026),
  // so this is one index probe no matter how many businesses exist. It
  // used to download EVERY connected Twilio row on every inbound call and
  // search them in JavaScript — slower with each business added, and
  // silently truncated at PostgREST's 1,000-row response cap, past which
  // some numbers would simply stop resolving.
  const { data: filtered, error: filterError } = await admin
    .from("integrations")
    .select("business_id, metadata")
    .eq("provider", "twilio")
    .eq("status", "connected")
    .eq("metadata->>phone_number", dialedNumber)
    .limit(1);

  let match: { business_id: string; metadata: unknown } | undefined = filtered?.[0];

  if (filterError) {
    // The one thing that must not happen is this lookup failing and
    // taking every business's phone line down with it. If the filtered
    // query itself errors, fall back to the old (slow, but correct below
    // the row cap) scan rather than treating it as "number not found."
    console.error("[resolveBusinessFromPhoneNumber] indexed lookup failed, falling back to full scan:", filterError);
    const { data: all, error: scanError } = await admin
      .from("integrations")
      .select("business_id, metadata")
      .eq("provider", "twilio")
      .eq("status", "connected");
    if (scanError || !all) return null;
    match = all.find((row) => {
      const meta = row.metadata as Record<string, unknown> | null;
      return meta && meta.phone_number === dialedNumber;
    });
  }

  if (!match) return null;

  const meta = match.metadata as Record<string, unknown> | null;
  return {
    businessId: match.business_id as string,
    subAccountAuthToken: (meta?.subaccount_auth_token as string) || null,
  };
}

export async function getBusinessTwilioAuthToken(businessId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("integrations")
    .select("metadata")
    .eq("business_id", businessId)
    .eq("provider", "twilio")
    .maybeSingle();

  const meta = data?.metadata as Record<string, unknown> | null;
  return (meta?.subaccount_auth_token as string) || null;
}
