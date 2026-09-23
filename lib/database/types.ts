export type UUID = string;
export type ISODate = string;
export type ISODateTime = string;

export interface DbBusiness {
  id: UUID;
  name: string;
  business_type: string | null;
  description: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  timezone: string;
  onboarding_step: OnboardingStep;
  onboarding_completed_at: ISODateTime | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: "none" | "trialing" | "active" | "past_due" | "canceled";
  cancel_at_period_end: boolean;
  current_period_end: ISODateTime | null;
  notification_preferences: { calls: boolean; escalations: boolean; digest: boolean } | null;

  // SpotOn POS connection. A business can take AI phone orders without
  // this connected — orders just sit at status "confirmed" instead of
  // "submitted" until the connection exists, same as any other
  // integration that hasn't been set up yet.
  spoton_location_id: string | null;
  spoton_access_token: string | null;
  spoton_refresh_token: string | null;
  spoton_token_expires_at: ISODateTime | null;
  spoton_connected_at: ISODateTime | null;
  spoton_menu_synced_at: ISODateTime | null;

  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export type OnboardingStep =
  | "business_info"
  | "hours"
  | "menu"
  | "ai_receptionist"
  | "voice"
  | "spoton"
  | "complete";

export interface DbBusinessMember {
  id: UUID;
  business_id: UUID;
  user_id: UUID;
  role: "owner" | "admin" | "member";
  created_at: ISODateTime;
}

export type Weekday = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

export interface DbBusinessHours {
  id: UUID;
  business_id: UUID;
  weekday: Weekday;
  is_open: boolean;
  open_time: string | null;
  close_time: string | null;
}

// --------------------------------------------------------------------------
// Menu
// --------------------------------------------------------------------------

export interface DbMenuCategory {
  id: UUID;
  business_id: UUID;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export type MenuItemSource = "manual" | "import" | "spoton_sync";

export interface DbMenuItem {
  id: UUID;
  business_id: UUID;
  category_id: UUID | null;
  name: string;
  description: string | null;
  price_cents: number;
  image_url: string | null;
  is_active: boolean;
  sort_order: number;
  // "manual"/"import" items aren't orderable by the AI until
  // spoton_item_id is set — see the migration comment for why.
  source: MenuItemSource;
  spoton_item_id: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface DbModifierGroup {
  id: UUID;
  business_id: UUID;
  menu_item_id: UUID;
  name: string;
  is_required: boolean;
  min_select: number;
  max_select: number;
  sort_order: number;
  spoton_modifier_group_id: string | null;
  created_at: ISODateTime;
}

export interface DbModifier {
  id: UUID;
  business_id: UUID;
  modifier_group_id: UUID;
  name: string;
  price_delta_cents: number;
  is_active: boolean;
  sort_order: number;
  spoton_modifier_id: string | null;
  created_at: ISODateTime;
}

// A menu item with its modifier groups/modifiers attached — the shape
// the AI's get_menu tool and the menu-management UI both work with.
export interface MenuItemWithModifiers extends DbMenuItem {
  modifier_groups: (DbModifierGroup & { modifiers: DbModifier[] })[];
}

// --------------------------------------------------------------------------
// Orders
// --------------------------------------------------------------------------

export type OrderStatus = "building" | "confirmed" | "submitted" | "failed" | "cancelled";

export interface DbOrder {
  id: UUID;
  business_id: UUID;
  call_id: UUID | null;
  customer_id: UUID | null;
  customer_name: string | null;
  phone: string | null;
  status: OrderStatus;
  fulfillment_type: "pickup";
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  special_instructions: string | null;
  spoton_order_id: string | null;
  submitted_at: ISODateTime | null;
  submit_error: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface DbOrderItem {
  id: UUID;
  order_id: UUID;
  menu_item_id: UUID | null;
  item_name: string;
  unit_price_cents: number;
  quantity: number;
  notes: string | null;
  created_at: ISODateTime;
}

export interface DbOrderItemModifier {
  id: UUID;
  order_item_id: UUID;
  modifier_id: UUID | null;
  modifier_name: string;
  price_delta_cents: number;
}

export interface OrderWithItems extends DbOrder {
  items: (DbOrderItem & { modifiers: DbOrderItemModifier[] })[];
}

// --------------------------------------------------------------------------
// Calls / AI (unchanged from the service-business model — a call is still
// a call regardless of what the AI does during it)
// --------------------------------------------------------------------------

export interface DbCall {
  id: UUID;
  business_id: UUID;
  customer_id: UUID | null;
  customer_name: string;
  phone: string;
  started_at: ISODateTime;
  duration_seconds: number;
  outcome: "order_placed" | "question_answered" | "escalated" | "no_action" | "missed";
  status: "completed" | "in_progress" | "missed" | "voicemail";
  handled_by: "ai" | "human";
  escalation_reason: string | null;
  recording_url: string | null;
  created_at: ISODateTime;
}

export interface DbCallMessage {
  id: UUID;
  call_id: UUID;
  role: "customer" | "ai" | "system";
  content: string;
  tool_call: string | null;
  created_at: ISODateTime;
}

export type Personality = "professional" | "friendly" | "warm" | "energetic" | "calm";

export interface AiResponsibilities {
  answer_questions: boolean;
  take_orders: boolean;
  modify_orders: boolean;
  collect_customer_info: boolean;
  escalate_to_human: boolean;
}

export interface DbAiReceptionist {
  id: UUID;
  business_id: UUID;
  name: string;
  personality: Personality;
  responsibilities: AiResponsibilities;
  status: "online" | "offline";
  escalation_rules: string | null;
  ordering_rules: string | null;
  generated_instructions: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export type VoiceId = "alex_professional" | "sarah_warm" | "james_calm" | "emma_friendly" | "custom";

export interface DbAiVoiceConfig {
  id: UUID;
  business_id: UUID;
  voice_id: VoiceId;
  provider: string | null;
  provider_voice_ref: string | null;
  provider_voice_name: string | null;
  created_at: ISODateTime;
}

export interface DbCustomer {
  id: UUID;
  business_id: UUID;
  name: string;
  phone: string;
  email: string | null;
  notes: string | null;
  is_blocked: boolean;
  blocked_at: ISODateTime | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export type KnowledgeCategory = "business_info" | "menu" | "faq" | "policy" | "custom";

export interface DbKnowledgeItem {
  id: UUID;
  business_id: UUID;
  category: KnowledgeCategory;
  question: string | null;
  title: string | null;
  content: string;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface DbPromotion {
  id: UUID;
  business_id: UUID;
  title: string;
  description: string;
  applies_to: string | null;
  start_date: ISODate;
  end_date: ISODate;
  is_active: boolean;
  created_at: ISODateTime;
}

export type IntegrationProvider =
  | "spoton"
  | "twilio"
  | "sms"
  | "voice_provider";

export type IntegrationStatus = "connected" | "not_connected" | "coming_soon";

export interface DbIntegration {
  id: UUID;
  business_id: UUID;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  external_account_id: string | null;
  connected_at: ISODateTime | null;
  metadata: Record<string, unknown> | null;
}

export interface DbReview {
  id: UUID;
  business_name: string;
  reviewer_name: string;
  rating: number;
  review_text: string;
  status: "pending" | "approved" | "rejected";
  created_at: ISODateTime;
}
