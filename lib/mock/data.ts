// Demo-mode fallback data — used only when Supabase isn't configured
// (e.g. local dev without env vars set), so the UI has something real
// enough to render instead of crashing. Never used once Supabase is
// actually connected.
import type {
  DbBusiness, DbBusinessHours, MenuItemWithModifiers, DbAiReceptionist, DbAiVoiceConfig,
  DbCall, DbCallMessage, DbCustomer, DbIntegration, DbKnowledgeItem, DbPromotion, OrderWithItems, DbReview,
} from "@/lib/database/types";

// ---- Platform-admin demo data (app/admin) — a small roster of
// businesses in different states, so the Command Center's stat cards
// and status filters have something real to show in a preview
// without a live Supabase project connected. ----
const ADMIN_BUSINESS_OVERRIDES: (Pick<DbBusiness, "id" | "name" | "subscription_status" | "cancel_at_period_end" | "current_period_end" | "created_at" | "phone"> & { is_suspended?: boolean; suspended_reason?: string | null })[] = [
  { id: "demo-business", name: "Demo Kitchen", subscription_status: "trialing", cancel_at_period_end: false, current_period_end: null, created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(), phone: "+15555550123" },
  { id: "demo-business-2", name: "Harbor Slice Pizzeria", subscription_status: "active", cancel_at_period_end: false, current_period_end: null, created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 41).toISOString(), phone: "+15555550187" },
  { id: "demo-business-3", name: "Bayview Diner", subscription_status: "active", cancel_at_period_end: true, current_period_end: new Date(Date.now() + 1000 * 60 * 60 * 24 * 12).toISOString(), created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 96).toISOString(), phone: "+15555550142" },
  { id: "demo-business-4", name: "Maple & Vine Bistro", subscription_status: "past_due", cancel_at_period_end: false, current_period_end: null, created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 58).toISOString(), phone: "+15555550199" },
  { id: "demo-business-5", name: "Corner Noodle House", subscription_status: "canceled", cancel_at_period_end: false, current_period_end: null, created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 130).toISOString(), phone: "+15555550164", is_suspended: true, suspended_reason: "Repeated chargebacks — paused pending a call with the owner." },
];

// The full roster the Command Center's table reads.
export const mockAdminBusinesses = ADMIN_BUSINESS_OVERRIDES;

export const mockCostBreakdown = { anthropicCents: 842, elevenLabsCents: 356, twilioCents: 214, totalCents: 1412 };
export const mockTotalSpentThisMonth = 68.42;

export const mockPendingReviews: DbReview[] = [
  { id: "demo-review-1", business_name: "Harbor Slice Pizzeria", reviewer_name: "Morgan T.", rating: 5, review_text: "The AI got our whole order right down to the extra napkins request. Wildly better than voicemail.", status: "pending", created_at: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString() },
];

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
  is_suspended: false,
  suspended_at: null,
  suspended_reason: null,
  spoton_location_id: null,
  spoton_access_token: null,
  spoton_refresh_token: null,
  spoton_token_expires_at: null,
  spoton_connected_at: null,
  spoton_menu_synced_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

// Admin roster, each row filled out to a complete DbBusiness (using
// mockBusiness as the default for every field the roster above doesn't
// itself vary), so clicking into any one of them from the demo Command
// Center opens a real, working business-detail page instead of a 404.
export const mockAdminBusinessDetails: DbBusiness[] = ADMIN_BUSINESS_OVERRIDES.map((b) => ({
  ...mockBusiness,
  ...b,
  is_suspended: b.is_suspended ?? false,
  suspended_reason: b.suspended_reason ?? null,
}));

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

export const mockCalls: DbCall[] = [
  {
    id: "demo-call-1",
    business_id: "demo-business",
    customer_id: "demo-customer-1",
    customer_name: "Jamie Rivera",
    phone: "+15555550100",
    started_at: new Date(Date.now() - 1000 * 60 * 34).toISOString(),
    duration_seconds: 118,
    outcome: "order_placed",
    status: "completed",
    handled_by: "ai",
    escalation_reason: null,
    recording_url: null,
    created_at: new Date(Date.now() - 1000 * 60 * 34).toISOString(),
  },
  {
    id: "demo-call-2",
    business_id: "demo-business",
    customer_id: null,
    customer_name: "Unknown Caller",
    phone: "+15555550199",
    started_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    duration_seconds: 46,
    outcome: "escalated",
    status: "completed",
    handled_by: "ai",
    escalation_reason: "Customer asked about a catering order for 50 people — outside standard ordering rules.",
    recording_url: null,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
  },
];
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

export const mockOrders: OrderWithItems[] = [
  {
    id: "demo-order-1",
    business_id: "demo-business",
    call_id: "demo-call-1",
    customer_id: "demo-customer-1",
    customer_name: "Jamie Rivera",
    phone: "+15555550100",
    status: "submitted",
    fulfillment_type: "pickup",
    subtotal_cents: 1698,
    tax_cents: 136,
    total_cents: 1834,
    special_instructions: null,
    spoton_order_id: null,
    submitted_at: new Date(Date.now() - 1000 * 60 * 33).toISOString(),
    submit_error: null,
    created_at: new Date(Date.now() - 1000 * 60 * 34).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 33).toISOString(),
    items: [
      {
        id: "demo-order-item-1",
        order_id: "demo-order-1",
        menu_item_id: "demo-item-1",
        item_name: "Cheeseburger",
        unit_price_cents: 1299,
        quantity: 1,
        notes: null,
        created_at: new Date(Date.now() - 1000 * 60 * 34).toISOString(),
        modifiers: [
          { id: "demo-order-mod-1", order_item_id: "demo-order-item-1", modifier_id: "demo-mod-2", modifier_name: "Double", price_delta_cents: 300 },
        ],
      },
      {
        id: "demo-order-item-2",
        order_id: "demo-order-1",
        menu_item_id: "demo-item-2",
        item_name: "Fries",
        unit_price_cents: 399,
        quantity: 1,
        notes: null,
        created_at: new Date(Date.now() - 1000 * 60 * 34).toISOString(),
        modifiers: [],
      },
    ],
  },
];
