import { createAdminClient } from "@/lib/supabase/admin";
import { loadBusinessContext } from "./context";
import { runTurn, type ConversationMessage } from "./claude";
import type { ToolContext } from "./tools";

export interface HandleTurnResult {
  reply: string;
  toolCalls: { name: string; input: unknown; result: any }[];
}

export async function startCall(businessId: string, callerNumber: string, dialedNumber: string): Promise<string> {
  const admin = createAdminClient();
  const { data: call, error } = await admin
    .from("calls")
    .insert({
      business_id: businessId,
      customer_name: "Phone Caller",
      phone: callerNumber,
      started_at: new Date().toISOString(),
      duration_seconds: 0,
      outcome: "no_action",
      status: "in_progress",
      handled_by: "ai",
    })
    .select()
    .single();

  if (error || !call) throw new Error(error?.message || "Could not start call.");
  return call.id;
}

export async function startTestSession(businessId: string): Promise<string> {
  const admin = createAdminClient();
  const { data: call, error } = await admin
    .from("calls")
    .insert({
      business_id: businessId,
      customer_name: "Test Session",
      phone: "test",
      started_at: new Date().toISOString(),
      duration_seconds: 0,
      outcome: "no_action",
      status: "in_progress",
      handled_by: "ai",
    })
    .select()
    .single();

  if (error || !call) throw new Error(error?.message || "Could not start test session.");
  return call.id;
}

export async function handleTurn(
  businessId: string,
  callId: string,
  userMessage: string,
  channel: "test" | "phone"
): Promise<HandleTurnResult> {
  const admin = createAdminClient();

  // Real retry protection. Twilio guarantees "at-least-once" webhook
  // delivery — if our response takes too long (which genuinely
  // happens on order turns: menu lookup, adding items, submitting to
  // SpotOn, confirmation SMS, all in sequence), Twilio assumes the
  // request failed and retries it, sending the exact same speech text
  // again. Without this check, that retry would silently reprocess the
  // whole turn — creating a duplicate order, a duplicate confirmation
  // text, and double AI cost. This is the actual root cause of an
  // order "repeating" on the Orders page.
  const { data: recentMessages } = await admin
    .from("call_messages")
    .select("id, role, content, created_at")
    .eq("call_id", callId)
    .order("created_at", { ascending: false })
    .limit(2);

  const lastCustomerMsg = (recentMessages || []).find((m) => m.role === "customer");
  if (lastCustomerMsg && lastCustomerMsg.content === userMessage) {
    const secondsSinceLastIdenticalMessage = (Date.now() - new Date(lastCustomerMsg.created_at).getTime()) / 1000;
    // 25 seconds comfortably covers Twilio's 15-second hard timeout
    // plus retry dispatch time, without being long enough to
    // incorrectly suppress a genuine, separate repeat of the same
    // phrase later in a real conversation.
    if (secondsSinceLastIdenticalMessage < 25) {
      const { data: existingReply } = await admin
        .from("call_messages")
        .select("content, tool_call")
        .eq("call_id", callId)
        .eq("role", "ai")
        .gt("created_at", lastCustomerMsg.created_at)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (existingReply) {
        // Already fully processed once — return the cached result
        // instead of doing everything (including side effects like
        // placing the order and texting) a second time.
        return {
          reply: existingReply.content,
          toolCalls: existingReply.tool_call ? JSON.parse(existingReply.tool_call).map((name: string) => ({ name, input: {}, result: {} })) : [],
        };
      }
      // No AI reply logged yet — the original request may still be
      // genuinely in progress. Fall through rather than risk
      // returning nothing to a real, still-in-flight turn.
    }
  }

  const context = await loadBusinessContext(businessId);
  if (!context) {
    return { reply: "Sorry, I'm having trouble accessing business information right now.", toolCalls: [] };
  }

  const { data: priorMessages } = await admin
    .from("call_messages")
    .select("role, content")
    .eq("call_id", callId)
    .neq("role", "system")
    .order("created_at", { ascending: true });

  const history: ConversationMessage[] = (priorMessages || []).map((m) => ({
    role: m.role === "ai" ? "assistant" : "user",
    content: m.content,
  }));

  await admin.from("call_messages").insert({ call_id: callId, role: "customer", content: userMessage });

  const toolCtx: ToolContext = { businessId, callId, channel, context };
  const result = await runTurn(history, userMessage, toolCtx);

  await admin.from("call_messages").insert({
    call_id: callId,
    role: "ai",
    content: result.reply,
    tool_call: result.toolCalls.length > 0 ? JSON.stringify(result.toolCalls.map((t) => t.name)) : null,
  });

  return result;
}

export async function endCall(callId: string, durationSeconds: number): Promise<void> {
  const admin = createAdminClient();
  await admin.from("calls").update({ status: "completed", duration_seconds: durationSeconds }).eq("id", callId);
}
