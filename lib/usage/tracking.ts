import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { mockCostBreakdown } from "@/lib/mock/data";

const RATE_NOTE_ANTHROPIC_HAIKU = "Claude Haiku 4.5, Sep 2026: $1.00/$5.00 per MTok (in/out)";
const RATE_NOTE_ANTHROPIC_SONNET = "Claude Sonnet 5, Sep 2026: $3.00/$15.00 per MTok (in/out)";
// eleven_turbo_v2_5 is now deprecated upstream (ElevenLabs points
// everyone at eleven_flash_v2_5/eleven_v4_turbo instead — see
// synthesizeSpeech in lib/integrations/telephony/elevenlabsProvider.ts,
// which now calls eleven_v4_turbo). This $/1,000-char figure is an
// ESTIMATE for display on the cost-summary page only — it doesn't
// drive any actual billing — read from ElevenLabs' public pricing
// as of Oct 2026 (their standard, non-promotional rate; they were
// running a temporary discount on this model at the time), not a
// live account-specific rate, so it can drift from a business's real
// invoice depending on their plan.
const RATE_NOTE_ELEVENLABS = "ElevenLabs Eleven v4 Turbo, Oct 2026 (est.): $0.04 per 1,000 characters";

export async function logAnthropicUsage(
  businessId: string,
  model: string,
  inputTokens: number,
  outputTokens: number
): Promise<void> {
  const isHaiku = model.includes("haiku");
  const inputRate = isHaiku ? 1.0 : 3.0;
  const outputRate = isHaiku ? 5.0 : 15.0;

  const costCents = ((inputTokens / 1_000_000) * inputRate + (outputTokens / 1_000_000) * outputRate) * 100;

  try {
    const admin = createAdminClient();
    await admin.from("usage_records").insert({
      business_id: businessId,
      provider: "anthropic",
      event_type: "chat_completion",
      quantity: inputTokens + outputTokens,
      unit: "tokens",
      estimated_cost_cents: costCents,
      rate_note: isHaiku ? RATE_NOTE_ANTHROPIC_HAIKU : RATE_NOTE_ANTHROPIC_SONNET,
    });
  } catch (err) {
    console.error("Failed to log Anthropic usage:", err);
  }
}

export async function logElevenLabsUsage(businessId: string, characterCount: number): Promise<void> {
  const costCents = (characterCount / 1000) * 0.04 * 100;

  try {
    const admin = createAdminClient();
    await admin.from("usage_records").insert({
      business_id: businessId,
      provider: "elevenlabs",
      event_type: "voice_synthesis",
      quantity: characterCount,
      unit: "characters",
      estimated_cost_cents: costCents,
      rate_note: RATE_NOTE_ELEVENLABS,
    });
  } catch (err) {
    console.error("Failed to log ElevenLabs usage:", err);
  }
}

// Twilio prices <Say> generative voices (which includes its ElevenLabs
// voices) at $0.013 per 100 characters — about 3x what ElevenLabs
// charges directly, which is why the Twilio-hosted path is for overflow
// or a deliberate choice, not a default. Logged under provider
// "elevenlabs" so the existing per-business cost breakdown (which sums
// that provider) includes it; the event_type tells it apart.
const RATE_NOTE_TWILIO_HOSTED_TTS = "Twilio <Say> ElevenLabs voice (generative), Oct 2026: $0.013 per 100 characters";

export async function logTwilioHostedTtsUsage(businessId: string, characterCount: number): Promise<void> {
  const costCents = (characterCount / 100) * 1.3;

  try {
    const admin = createAdminClient();
    await admin.from("usage_records").insert({
      business_id: businessId,
      provider: "elevenlabs",
      event_type: "voice_synthesis_twilio_hosted",
      quantity: characterCount,
      unit: "characters",
      estimated_cost_cents: costCents,
      rate_note: RATE_NOTE_TWILIO_HOSTED_TTS,
    });
  } catch (err) {
    console.error("Failed to log Twilio-hosted TTS usage:", err);
  }
}

export interface BusinessCostBreakdown {
  anthropicCents: number;
  elevenLabsCents: number;
  twilioCents: number;
  totalCents: number;
}

export async function getBusinessCostBreakdown(businessId: string): Promise<BusinessCostBreakdown> {
  if (!isSupabaseConfigured()) return mockCostBreakdown;
  const admin = createAdminClient();

  const [{ data: usageRecords }, { data: calls }] = await Promise.all([
    admin.from("usage_records").select("provider, estimated_cost_cents").eq("business_id", businessId),
    admin.from("calls").select("duration_seconds").eq("business_id", businessId),
  ]);

  const anthropicCents = (usageRecords || []).filter((r) => r.provider === "anthropic").reduce((sum, r) => sum + Number(r.estimated_cost_cents), 0);
  const elevenLabsCents = (usageRecords || []).filter((r) => r.provider === "elevenlabs").reduce((sum, r) => sum + Number(r.estimated_cost_cents), 0);

  const totalMinutes = (calls || []).reduce((sum, c) => sum + c.duration_seconds, 0) / 60;
  const twilioCents = totalMinutes * 4.85;

  return {
    anthropicCents,
    elevenLabsCents,
    twilioCents,
    totalCents: anthropicCents + elevenLabsCents + twilioCents,
  };
}
