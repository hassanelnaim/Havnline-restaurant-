import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { mockCostBreakdown } from "@/lib/mock/data";

const RATE_NOTE_ANTHROPIC_HAIKU = "Claude Haiku 4.5, Sep 2026: $1.00/$5.00 per MTok (in/out)";
const RATE_NOTE_ANTHROPIC_SONNET = "Claude Sonnet 5, Sep 2026: $3.00/$15.00 per MTok (in/out)";
const RATE_NOTE_ELEVENLABS = "ElevenLabs Turbo v2.5, Sep 2026: $0.05 per 1,000 characters";

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
  const costCents = (characterCount / 1000) * 0.05 * 100;

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
