export type UUID = string;
export type ISODate = string;
export type ISODateTime = string;

export interface DbBusiness {
  id: UUID;
  name: string;
  business_type: string | null;
  description: string | null;
  address: string | null;
  // Structured address used for real sales-tax calculation via Stripe
  // Tax (lib/billing/stripeTax.ts) -- see migration 023. `address`
  // above stays a free-text display string; these are what actually
  // get sent to Stripe for a rate lookup.
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
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

  // Platform-admin suspension (app/admin) — separate from billing
  // status above. A suspended business also has its AI order-taker
  // forced offline; see suspendBusinessAction.
  is_suspended: boolean;
  suspended_at: ISODateTime | null;
  suspended_reason: string | null;

  // HavnLine Printer App connection. A business can take AI phone
  // orders without this connected — orders just sit at status
  // "confirmed" instead of "submitted" until a tablet is paired. See
  // printer_devices for the actual paired device/printer IP; this is
  // just the fast, no-extra-query flag lib/ai/tools.ts checks per turn.
  printer_app_paired_at: ISODateTime | null;

  // DEPRECATED (see migration 023): used to be a manually-entered sales
  // tax percentage, in basis points (825 = 8.25%). No longer read or
  // written anywhere -- tax is now calculated live via Stripe Tax
  // (lib/billing/stripeTax.ts) from address_city/address_state/
  // address_zip above. Kept only so old rows/migrations don't break.
  tax_rate_bps: number;

  // Stripe CONNECTED account for customer phone-order payments —
  // separate from stripe_customer_id/stripe_subscription_id above,
  // which are the business's OWN subscription billed to HavnLine's
  // Stripe account. Money charged to a connected account pays out
  // straight to the restaurant's own bank; HavnLine never holds it.
  stripe_connect_account_id: string | null;
  stripe_connect_charges_enabled: boolean;
  stripe_connect_onboarded_at: ISODateTime | null;
  // Explicit opt-in, separate from having connected an account at
  // all — connecting is not itself consent to start charging
  // customers. Until this is true, phone orders stay pay-at-pickup
  // exactly as they work today, even if Connect is set up.
  phone_payments_enabled: boolean;
  // HavnLine's application fee on each paid phone order, in basis
  // points. Null = not configured yet (no fee taken), not the same
  // as 0 (explicitly free).
  platform_fee_bps: number | null;

  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export type OnboardingStep =
  | "business_info"
  | "hours"
  | "menu"
  | "ai_receptionist"
  | "voice"
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

export type MenuItemSource = "manual" | "import";

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
  source: MenuItemSource;
  // Time-based pricing (e.g. a Breakfast Special that's cheaper before
  // 11am) — all three must be set for it to apply. When any are null,
  // this item just uses price_cents all the time, exactly as before.
  special_price_cents: number | null;
  special_price_start_time: string | null;
  special_price_end_time: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface DbModifierGroup {
  id: UUID;
  business_id: UUID;
  // Null when is_template is true — a shared, business-wide add-on
  // group (e.g. "Toppings") isn't tied to any single item. Set when
  // is_template is false — the original one-off-per-item model, unchanged.
  menu_item_id: UUID | null;
  name: string;
  is_required: boolean;
  min_select: number;
  max_select: number;
  sort_order: number;
  is_template: boolean;
  created_at: ISODateTime;
}

// Attaches a shared template group (DbModifierGroup with is_template:
// true) to a menu item. A one-off group's link is still just its own
// menu_item_id column — this table only ever links templates.
export interface DbMenuItemModifierGroup {
  id: UUID;
  business_id: UUID;
  menu_item_id: UUID;
  modifier_group_id: UUID;
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

// Independent of OrderStatus above. An order can be status="confirmed"
// while payment_status="awaiting_payment" — it exists and the total's
// been read back, but nothing prints to the kitchen and status never
// reaches "submitted" until this flips to "paid" (see the Stripe
// Connect webhook). "not_required" is a pay-at-pickup order — either
// the business hasn't turned on phone payments, or it's an order from
// before this feature existed.
export type OrderPaymentStatus = "not_required" | "awaiting_payment" | "paid" | "refunded" | "partially_refunded" | "failed";

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
  submitted_at: ISODateTime | null;
  submit_error: string | null;
  payment_status: OrderPaymentStatus;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  amount_refunded_cents: number;
  refund_reason: string | null;
  refunded_by: UUID | null;
  refunded_at: ISODateTime | null;
  voided_by: UUID | null;
  voided_at: ISODateTime | null;
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
// HavnLine Printer App — see lib/database/migrations/011_printer_app.sql
// and lib/integrations/printer-app.ts.
// --------------------------------------------------------------------------

export interface DbPrinterPairingCode {
  id: UUID;
  business_id: UUID;
  code: string;
  expires_at: ISODateTime;
  claimed_at: ISODateTime | null;
  created_at: ISODateTime;
}

export interface DbPrinterDevice {
  id: UUID;
  business_id: UUID;
  device_token: string;
  printer_ip: string | null;
  paired_at: ISODateTime;
  last_seen_at: ISODateTime | null;
}

export type PrinterPrintJobStatus = "pending" | "printed" | "failed";

export interface DbPrinterPrintJob {
  id: UUID;
  business_id: UUID;
  order_id: UUID;
  ticket_text: string;
  status: PrinterPrintJobStatus;
  error: string | null;
  created_at: ISODateTime;
  printed_at: ISODateTime | null;
  // Set the moment a job is handed to the tablet on a poll — not when
  // it's actually printed. Stops the same still-"pending" job from
  // being handed out again to an overlapping or retried poll before
  // its ack has had a chance to arrive. Cleared on a failed ack (or
  // just ages out after CLAIM_TIMEOUT_MS) so a genuinely stuck job —
  // tablet crashed, connection dropped — still gets retried instead of
  // being lost. See app/api/printer-app/orders/route.ts.
  claimed_at: ISODateTime | null;
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
  | "twilio"
  | "sms"
  | "printer_app";

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
