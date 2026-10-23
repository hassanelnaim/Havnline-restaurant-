/**
 * How a turn's tool calls are stored on its assistant message
 * (call_messages.tool_call), and read back. Besides each tool's name, the
 * few result fields the phone webhooks act on are kept, so a turn whose
 * reply is fetched later (a Twilio retry, or a turn that ran past the
 * deadline, see turnRunner.ts) still transfers the call or wraps up after
 * an order exactly as the original would have.
 *
 * Older rows hold a plain list of names; both forms are read.
 */
export interface StoredToolCall {
  name: string;
  input: unknown;
  result: Record<string, unknown>;
}

const KEPT_RESULT_FIELDS = ["success", "order_id", "live_transfer", "transferring", "payment_link_sent", "already_placed"] as const;

export function encodeToolCalls(toolCalls: { name: string; result?: unknown }[]): string | null {
  if (toolCalls.length === 0) return null;
  return JSON.stringify(
    toolCalls.map((t) => {
      const r = (t.result || {}) as Record<string, unknown>;
      const kept: Record<string, unknown> = {};
      for (const f of KEPT_RESULT_FIELDS) if (r[f] !== undefined) kept[f] = r[f];
      return { name: t.name, r: kept };
    })
  );
}

export function decodeToolCalls(stored: string | null | undefined): StoredToolCall[] {
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry) =>
      typeof entry === "string" ? { name: entry, input: {}, result: {} } : { name: String(entry?.name || ""), input: {}, result: (entry?.r as Record<string, unknown>) || {} }
    );
  } catch {
    return [];
  }
}

import { createAdminClient } from "@/lib/supabase/admin";

export interface StoredTurnReply {
  reply: string;
  toolCalls: StoredToolCall[];
  turnCount: number;
}

/**
 * Waits for the assistant's reply to the caller's `seq`-th message (0-based)
 * to be saved, by the request that is producing it. Used when a second
 * request for the same turn arrives while the first is still thinking (a
 * Twilio retry), and when a turn ran past the deadline and the caller is
 * waiting on a follow-up request (turnRunner.ts). null if it doesn't show
 * up in time.
 */
export async function waitForTurnReply(callId: string, seq: number, timeoutMs: number): Promise<StoredTurnReply | null> {
  const admin = createAdminClient();
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const { data: rows } = await admin
      .from("call_messages")
      .select("role, content, tool_call, created_at")
      .eq("call_id", callId)
      .neq("role", "system")
      .order("created_at", { ascending: true });
    const all = rows || [];
    const customers = all.filter((m) => m.role === "customer");
    const original = customers[seq];
    if (original) {
      const next = all[all.indexOf(original) + 1];
      if (next && next.role === "ai") return { reply: next.content, toolCalls: decodeToolCalls(next.tool_call), turnCount: seq + 1 };
    }
    if (Date.now() + 400 > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}
