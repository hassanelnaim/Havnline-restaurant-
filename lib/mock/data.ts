// Demo-mode fallback data — used only when Supabase isn't configured
// (e.g. local dev without env vars set), so the UI has something real
// enough to render instead of crashing. Never used once Supabase is
// actually connected.
import type {
  DbBusiness, DbBusinessHours, MenuItemWithModifiers, DbAiReceptionist, DbAiVoiceConfig,
  DbCall, DbCallMessage, DbCustomer, DbIntegration, DbKnowledgeItem, DbPromotion, OrderWithItems,
} from "@/lib/database/types";

export const mockBusiness: DbBusiness = {
  id: "demo-business",
  name: "Demo Kitchen",
  business_type: "Restaurant",
  description: "A demo restaurant used to preview HavnLine before you connect a real account.",
  address: "123 Main St, Anytown, MI",
  phone: "+15555550123",
  website: null,
  timezone: "America/New_York",
  onboarding_step: "complete",
  onboarding_completed_at: new Date().toISOString(),
  stripe_customer_id: null,
  stripe_subscription_id: null,
  subscription_status: "trialing",
  cancel_at_period_end: false,
  current_period_end: null,
  notification_preferences: { calls: true, escalations: true, digest: true },
  spoton_location_id: null,
  spoton_access_token: null,
  spoton_refresh_token: null,
  spoton_token_expires_at: null,
  spoton_connected_at: null,
  spoton_menu_synced_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

export const mockBusinessHours: DbBusinessHours[] = [
  { id: "1", business_id: "demo-business", weekday: "monday", is_open: true, open_time: "11:00", close_time: "21:00" },
  { id: "2", business_id: "demo-business", weekday: "tuesday", is_open: true, open_time: "11:00", close_time: "21:00" },
  { id: "3", business_id: "demo-business", weekday: "wednesday", is_open: true, open_time: "11:00", close_time: "21:00" },
  { id: "4", business_id: "demo-business", weekday: "thursday", is_open: true, open_time: "11:00", close_time: "21:00" },
  { id: "5", business_id: "demo-business", weekday: "friday", is_open: true, open_time: "11:00", close_time: "22:00" },
  { id: "6", business_id: "demo-business", weekday: "saturday", is_open: true, open_time: "11:00", close_time: "22:00" },
  { id: "7", business_id: "demo-business", weekday: "sunday", is_open: false, open_time: null, close_time: null },
];

export const mockMenuItems: MenuItemWithModifiers[] = [
  {
    id: "demo-item-1",
    business_id: "demo-business",
    category_id: null,
    name: "Cheeseburger",
    description: "Angus beef, cheddar, lettuce, tomato.",
    price_cents: 1299,
    image_url: null,
    is_active: true,
    sort_order: 0,
    source: "manual",
    spoton_item_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    modifier_groups: [
      {
        id: "demo-group-1",
        business_id: "demo-business",
        menu_item_id: "demo-item-1",
        name: "Size",
        is_required: true,
        min_select: 1,
        max_select: 1,
        sort_order: 0,
        spoton_modifier_group_id: null,
        created_at: new Date().toISOString(),
        modifiers: [
          { id: "demo-mod-1", business_id: "demo-business", modifier_group_id: "demo-group-1", name: "Regular", price_delta_cents: 0, is_active: true, sort_order: 0, spoton_modifier_id: null, created_at: new Date().toISOString() },
          { id: "demo-mod-2", business_id: "demo-business", modifier_group_id: "demo-group-1", name: "Double", price_delta_cents: 300, is_active: true, sort_order: 1, spoton_modifier_id: null, created_at: new Date().toISOString() },
        ],
      },
    ],
  },
  {
    id: "demo-item-2",
    business_id: "demo-business",
    category_id: null,
    name: "Fries",
    description: "Crispy golden fries.",
    price_cents: 399,
    image_url: null,
    is_active: true,
    sort_order: 1,
    source: "manual",
    spoton_item_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    modifier_groups: [],
  },
];

export const mockAiReceptionist: DbAiReceptionist = {
  id: "demo-ai",
  business_id: "demo-business",
  name: "Alex",
  personality: "friendly",
  responsibilities: { answer_questions: true, take_orders: true, modify_orders: true, collect_customer_info: true, escalate_to_human: true },
  status: "offline",
  escalation_rules: null,
  ordering_rules: null,
  generated_instructions: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

export const mockVoiceConfig: DbAiVoiceConfig = {
  id: "demo-voice",
  business_id: "demo-business",
  voice_id: "alex_professional",
  provider: null,
  provider_voice_ref: null,
  provider_voice_name: null,
  created_at: new Date().toISOString(),
};

export const mockCalls: DbCall[] = [];
export const mockCallMessages: DbCallMessage[] = [];

export const mockCustomers: DbCustomer[] = [
  {
    id: "demo-customer-1",
    business_id: "demo-business",
    name: "Jamie Rivera",
    phone: "+15555550100",
    email: null,
    notes: null,
    is_blocked: false,
    blocked_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export const mockIntegrations: DbIntegration[] = [
  { id: "demo-int-spoton", business_id: "demo-business", provider: "spoton", status: "not_connected", external_account_id: null, connected_at: null, metadata: null },
  { id: "demo-int-twilio", business_id: "demo-business", provider: "twilio", status: "not_connected", external_account_id: null, connected_at: null, metadata: null },
];

export const mockKnowledgeItems: DbKnowledgeItem[] = [];
export const mockPromotions: DbPromotion[] = [];

export const mockOrders: OrderWithItems[] = [];
