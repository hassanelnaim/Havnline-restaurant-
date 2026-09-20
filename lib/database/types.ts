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
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export type OnboardingStep =
  | "business_info"
  | "hours"
  | "services"
  | "ai_receptionist"
  | "voice"
  | "calendar"
  | "complete";

export interface DbBusinessMember {
  id: UUID;
  business_id: UUID;
  user_id: UUID;
  role: "owner" | "admin" | "member";
  created_at: ISODateTime;
}

export interface DbService {
  id: UUID;
  business_id: UUID;
  name: string;
  description: string | null;
  price_cents: number;
  duration_minutes: number;
  is_active: boolean;
  created_at: ISODateTime;
  updated_at: ISODateTime;
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

export type Personality = "professional" | "friendly" | "warm" | "energetic" | "calm";

export interface AiResponsibilities {
  answer_questions: boolean;
  schedule_appointments: boolean;
  reschedule_appointments: boolean;
  cancel_appointments: boolean;
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
  booking_rules: string | null;
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

export interface DbCall {
  id: UUID;
  business_id: UUID;
  customer_id: UUID | null;
  customer_name: string;
  phone: string;
  started_at: ISODateTime;
  duration_seconds: number;
  outcome: "appointment_booked" | "question_answered" | "escalated" | "no_action" | "missed";
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

export interface DbAppointment {
  id: UUID;
  business_id: UUID;
  customer_id: UUID | null;
  customer_name: string;
  phone: string;
  service_id: UUID | null;
  service_name: string;
  date: ISODate;
  time: string;
  status: "confirmed" | "pending" | "cancelled" | "completed" | "no_show";
  created_via: "ai" | "human";
  sms_consent: boolean;
  reminder_sent_at: ISODateTime | null;
  created_at: ISODateTime;
}

export type KnowledgeCategory = "business_info" | "services" | "pricing" | "faq" | "policy" | "custom";

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
  | "google_calendar"
  | "icloud_calendar"
  | "microsoft_outlook"
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
