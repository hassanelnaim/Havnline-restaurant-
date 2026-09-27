import { createAdminClient } from "@/lib/supabase/admin";
import type {
  DbAiReceptionist, DbAiVoiceConfig, DbBusiness, DbBusinessHours,
  DbKnowledgeItem, DbPromotion, MenuItemWithModifiers,
} from "@/lib/database/types";

export interface BusinessContext {
  business: DbBusiness;
  hours: DbBusinessHours[];
  menu: MenuItemWithModifiers[];
  ai: DbAiReceptionist;
  voice: DbAiVoiceConfig | null;
  knowledge: DbKnowledgeItem[];
  activePromotions: DbPromotion[];
}

export async function loadBusinessContext(businessId: string): Promise<BusinessContext | null> {
  const admin = createAdminClient();

  const [businessRes, hoursRes, itemsRes, groupsRes, modifiersRes, aiRes, voiceRes, knowledgeRes, promotionsRes] = await Promise.all([
    admin.from("businesses").select("*").eq("id", businessId).single(),
    admin.from("business_hours").select("*").eq("business_id", businessId),
    admin.from("menu_items").select("*").eq("business_id", businessId).eq("is_active", true).order("sort_order"),
    admin.from("modifier_groups").select("*").eq("business_id", businessId).order("sort_order"),
    admin.from("modifiers").select("*").eq("business_id", businessId).eq("is_active", true).order("sort_order"),
    admin.from("ai_receptionists").select("*").eq("business_id", businessId).single(),
    admin.from("ai_voice_configs").select("*").eq("business_id", businessId).maybeSingle(),
    admin.from("knowledge_items").select("*").eq("business_id", businessId),
    admin.from("promotions").select("*").eq("business_id", businessId).eq("is_active", true),
  ]);

  if (businessRes.error || !businessRes.data) return null;
  if (aiRes.error || !aiRes.data) return null;

  const business = businessRes.data as DbBusiness;
  const groups = groupsRes.data || [];
  const allModifiers = modifiersRes.data || [];

  const rawItems = itemsRes.data || [];

  const menu: MenuItemWithModifiers[] = rawItems.map((item) => ({
    ...item,
    modifier_groups: groups
      .filter((g) => g.menu_item_id === item.id)
      .map((g) => ({ ...g, modifiers: allModifiers.filter((m) => m.modifier_group_id === g.id) })),
  }));

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
    voice: voiceRes.data || null,
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
  const { data, error } = await admin
    .from("integrations")
    .select("business_id, metadata")
    .eq("provider", "twilio")
    .eq("status", "connected");

  if (error || !data) return null;

  const match = data.find((row) => {
    const meta = row.metadata as Record<string, unknown> | null;
    return meta && meta.phone_number === dialedNumber;
  });

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
