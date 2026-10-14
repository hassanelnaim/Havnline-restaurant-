import { createAdminClient } from "@/lib/supabase/admin";
import { loadBusinessContext } from "./context";
import { runTurn, type ConversationMessage, type RunTurnResult } from "./claude";
import type { ToolContext } from "./tools";
import { createTimer, shortId, type Timer } from "@/lib/monitoring/timing";
import { loadCurrentOrder } from "./orderState";

export interface HandleTurnResult {
  reply: string;
  toolCalls: { name: string; input: unknown; result: any }[];
  /**
   * How many things the caller has said so far on this call, counting this
   * one. The next <Gather> carries it back as `seq` so a repeat of THIS
   * request can be told apart from the caller genuinely saying the same
   * word again (see handleTurn).
   */
  turnCount?: number;
}

export interface HandleTurnOptions {
  /** The calling webhook's timer, so one log line shows the whole turn. */
  timer?: Timer;
  /**
   * `seq` from the request URL: how many caller messages existed when the
   * TwiML that led to this request was issued. Absent on paths that don't
   * carry it (and on the dashboard's test chat).
   */
  seq?: number | null;
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
  channel: "test" | "phone",
  options: HandleTurnOptions = {}
): Promise<HandleTurnResult> {
  const admin = createAdminClient();
  const timer = options.timer ?? createTimer("turn", { call: shortId(callId) });

  try {
    // Everything this turn needs to read, fetched at once. These used to run
    // one after another — retry check, business, caller's number, history —
    // and the caller was waiting in silence through each round trip. None of
    // them depends on another's result, and none of them reads the customer
    // message this turn is about to write.
    const [context, { data: callRow }, { data: priorMessages }, currentOrder] = await Promise.all([
      loadBusinessContext(businessId, { fresh: channel === "test" }),
      admin.from("calls").select("phone").eq("id", callId).maybeSingle(),
      admin.from("call_messages").select("role, content, tool_call, created_at").eq("call_id", callId).neq("role", "system").order("created_at", { ascending: true }),
      loadCurrentOrder(callId),
    ]);
    timer.mark("load");

    const priorCustomerCount = (priorMessages || []).filter((m) => m.role === "customer").length;

    // Retry protection. Twilio can deliver the same webhook request twice
    // (for example if the connection drops mid-request), sending the exact
    // same speech text again. Reprocessing it would add the items twice and
    // double the AI cost.
    //
    // A repeat is recognised by the request itself, not by its words: every
    // <Gather> we send back carries `seq`, the number of things the caller
    // had said when it was issued. A genuine next request carries a seq equal
    // to the number of messages recorded so far; a repeat of a request that
    // was already handled carries an OLDER seq (the original has since
    // recorded another caller message). Comparing words instead — "has the
    // caller said this same thing in the last 25 seconds?" — can't tell a
    // repeated request from a caller who legitimately says "no" and then "no"
    // again, and answered the second "no" with a replay of the reply to the
    // first, so the assistant asked the same question twice in a row.
    if (typeof options.seq === "number" && priorCustomerCount > options.seq) {
      const rows = priorMessages || [];
      const customerRows = rows.filter((m) => m.role === "customer");
      const original = customerRows[options.seq];
      if (original && original.content === userMessage) {
        const originalIndex = rows.indexOf(original);
        const next = rows[originalIndex + 1];
        const reply = next && next.role === "ai" ? next : undefined;
        if (reply) {
          // Already fully processed once — return the stored result instead
          // of doing everything (including side effects like placing the
          // order and texting) a second time.
          timer.set("retry", true);
          return {
            reply: reply.content,
            toolCalls: reply.tool_call ? JSON.parse(reply.tool_call).map((name: string) => ({ name, input: {}, result: {} })) : [],
            turnCount: priorCustomerCount,
          };
        }
        // No AI reply logged yet — the original request may still be
        // genuinely in progress. Fall through rather than risk returning
        // nothing to a real, still-in-flight turn.
      }
    }

    if (!context) {
      return { reply: "Sorry, I'm having trouble accessing business information right now.", toolCalls: [] };
    }

    const callerPhone = channel === "phone" ? callRow?.phone || null : null;

    let history: ConversationMessage[] = (priorMessages || []).map((m) => ({
      role: m.role === "ai" ? "assistant" : "user",
      content: m.content,
    }));

    // Phone calls run on a smaller, faster model (see claude.ts) chosen
    // for latency, not for how well it holds up across a long, growing
    // transcript. The full system prompt (menu, hours, rules) is already
    // rebuilt fresh on every single turn, so nothing there gets "lost" —
    // but an uncapped back-and-forth history does dilute a small model's
    // attention the longer a call runs, which is what actually produces
    // that "gets dumber as the call goes on" effect. Keeping only the
    // most recent turns keeps the model's attention on what's currently
    // relevant (the order being built) without losing anything it needs,
    // since order state itself lives in the database, not in the
    // conversation history, and get_current_order can always be called
    // to see the real, current order regardless of how far back it
    // started.
    const MAX_PHONE_HISTORY_MESSAGES = 20;
    if (channel === "phone" && history.length > MAX_PHONE_HISTORY_MESSAGES) {
      history = history.slice(-MAX_PHONE_HISTORY_MESSAGES);
    }

    // The customer's message is saved while the model is thinking instead of
    // before it — nothing the model or its tools do needs that row. It is
    // started right now (so it is in the database within milliseconds, long
    // before a Twilio retry could arrive) and awaited before this turn
    // finishes, so it is never left running after the response is sent, and
    // always lands before the assistant's reply row.
    const saveCustomerMessage = (async () => {
      try {
        const { error } = await admin.from("call_messages").insert({ call_id: callId, role: "customer", content: userMessage });
        if (error) console.error(`[handleTurn] could not save the customer message for call ${callId}:`, error.message);
      } catch (err) {
        console.error(`[handleTurn] could not save the customer message for call ${callId}:`, err);
      }
    })();

    const toolCtx: ToolContext = { businessId, callId, channel, context, callerPhone };
    let result: RunTurnResult;
    try {
      result = await runTurn(history, userMessage, toolCtx, { currentOrder });
    } finally {
      await saveCustomerMessage;
    }
    timer.mark("ai");
    if (result.stats) {
      timer.set("model_calls", result.stats.modelCalls);
      timer.set("model_ms", result.stats.modelMs);
      timer.set("tool_ms", result.stats.toolMs);
      timer.set("tools", result.toolCalls.map((t) => t.name).join("+") || "none");
      timer.set("cache_read", result.stats.cacheReadTokens);
      timer.set("cache_write", result.stats.cacheWriteTokens);
      timer.set("input_tokens", result.stats.inputTokens);
    }

    await admin.from("call_messages").insert({
      call_id: callId,
      role: "ai",
      content: result.reply,
      tool_call: result.toolCalls.length > 0 ? JSON.stringify(result.toolCalls.map((t) => t.name)) : null,
    });
    timer.mark("save_reply");

    return { ...result, turnCount: priorCustomerCount + 1 };
  } finally {
    // A timer this function created is finished here; one handed in by a
    // webhook is finished by that webhook.
    if (!options.timer) timer.done();
  }
}

/**
 * Twilio's call-ended callback is configured on the phone NUMBER (see
 * provisionNumber), so it can't carry this app's own call id the way a
 * per-call URL could — it only carries the caller's number, the dialed
 * number and Twilio's CallSid. Without a way back to the call row, every
 * call stayed "in_progress" with a duration of 0 forever and the
 * call-finished email never went out. The caller's number is what
 * startCall stored in calls.phone, so the call that just ended is that
 * business's newest still-in-progress call from that number. (Two
 * simultaneous calls from the same number to the same business are the
 * only case this could mix up.)
 */
export async function findInProgressCallId(businessId: string, callerNumber: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("calls")
    .select("id")
    .eq("business_id", businessId)
    .eq("phone", callerNumber)
    .eq("status", "in_progress")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export async function endCall(callId: string, durationSeconds: number): Promise<void> {
  const admin = createAdminClient();
  // One retry: a call left "in_progress" forever never shows a duration
  // or sends its end-of-call email, and Twilio does not resend this
  // callback if our server answered with an error.
  let lastError: { message: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await admin.from("calls").update({ status: "completed", duration_seconds: durationSeconds }).eq("id", callId);
    if (!error) return;
    lastError = error;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Could not mark call ${callId} completed: ${lastError?.message}`);
}
