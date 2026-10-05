import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "./systemPrompt";
import { TOOL_DEFINITIONS, TOOL_HANDLERS, type ToolContext } from "./tools";
import type { BusinessContext } from "./context";
import { logAnthropicUsage } from "@/lib/usage/tracking";
import { TransientAiError, isTransientAiError } from "./errors";

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const PHONE_MODEL = process.env.ANTHROPIC_PHONE_MODEL || "claude-haiku-4-5-20251001";
// Used when the model a turn started on is rate-limited or overloaded.
// Anthropic's rate limits are tracked per model, so a different model is
// a genuinely separate pool of capacity — unlike retrying the same one
// into the same wall. Slower than Haiku, but a slower answer beats a
// dropped call.
const ALTERNATE_PHONE_MODEL = process.env.ANTHROPIC_PHONE_FALLBACK_MODEL || "claude-sonnet-5";

// Twilio gives up on a webhook after 15 seconds, so a phone turn has to
// finish — or fail cleanly — well inside that. The SDK's own default
// timeout is 10 MINUTES, which on a hung request would hold a caller in
// silence until Twilio hung up on them.
const REQUEST_TIMEOUT_MS = 6000;
const PHONE_TURN_BUDGET_MS = 11000;
// Below this there isn't enough time left for a second attempt to
// finish, so failing now (and re-prompting the caller) beats starting
// one Twilio will abandon halfway through.
const MIN_TIME_FOR_ANOTHER_ATTEMPT_MS = 2500;

// One client for the life of the instance instead of one per turn, so
// connections get reused across turns. maxRetries is 0 on purpose: the
// SDK's default (2) retries the SAME model with its own backoff, which
// during a rate-limit just burns the turn's time budget. Recovery is
// handled below by switching to the alternate model instead.
let sharedClient: { apiKey: string; client: Anthropic } | null = null;
function getClient(apiKey: string): Anthropic {
  if (!sharedClient || sharedClient.apiKey !== apiKey) {
    sharedClient = { apiKey, client: new Anthropic({ apiKey, maxRetries: 0, timeout: REQUEST_TIMEOUT_MS }) };
  }
  return sharedClient.client;
}

function isCapacityOrTimeoutError(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError) return true; // includes connection timeouts
  if (err instanceof Anthropic.APIError && typeof err.status === "number") {
    return err.status === 408 || err.status === 429 || err.status >= 500;
  }
  return isTransientAiError(err);
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface RunTurnResult {
  reply: string;
  toolCalls: { name: string; input: unknown; result: unknown }[];
}

export async function runTurn(
  history: ConversationMessage[],
  userMessage: string,
  toolCtx: ToolContext,
  options: { maxTokens?: number; model?: string } = {}
): Promise<RunTurnResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { reply: "I'm having trouble connecting right now — please try again in a moment.", toolCalls: [] };
  }

  const client = getClient(apiKey);
  const turnStartedAt = Date.now();
  let model = options.model || (toolCtx.channel === "phone" ? PHONE_MODEL : DEFAULT_MODEL);
  // 150 was tight enough to occasionally cut a reply off mid-sentence
  // once an order had a few items in it (the read-back alone can run
  // long) — 240 gives that room while staying short enough to keep
  // phone replies fast.
  const maxTokens = options.maxTokens || (toolCtx.channel === "phone" ? 240 : 1024);

  const system = buildSystemPrompt(toolCtx.context, toolCtx.channel);

  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  const toolCalls: { name: string; input: unknown; result: unknown }[] = [];
  let finalReply = "";

  for (let iteration = 0; iteration < 5; iteration++) {
    // A phone turn that has already spent its time budget (a slow tool,
    // a slow first call) stops here rather than starting another model
    // call Twilio will abandon — see PHONE_TURN_BUDGET_MS.
    const remainingMs = PHONE_TURN_BUDGET_MS - (Date.now() - turnStartedAt);
    if (toolCtx.channel === "phone" && iteration > 0 && remainingMs < MIN_TIME_FOR_ANOTHER_ATTEMPT_MS) {
      break;
    }

    let response: Anthropic.Message;
    try {
      response = await client.messages.create(
        { model, max_tokens: maxTokens, system, messages, tools: TOOL_DEFINITIONS },
        { timeout: Math.max(1500, Math.min(REQUEST_TIMEOUT_MS, remainingMs - 300)) }
      );
    } catch (err) {
      if (!isCapacityOrTimeoutError(err)) throw err;

      const alternate = model === ALTERNATE_PHONE_MODEL ? PHONE_MODEL : ALTERNATE_PHONE_MODEL;
      const remainingAfterFailure = PHONE_TURN_BUDGET_MS - (Date.now() - turnStartedAt);
      if (alternate === model || remainingAfterFailure < MIN_TIME_FOR_ANOTHER_ATTEMPT_MS) {
        throw new TransientAiError(`Anthropic unavailable for ${model}: ${err instanceof Error ? err.message : String(err)}`, err);
      }

      console.warn(`[claude] ${model} unavailable (${err instanceof Error ? err.message : err}); retrying this turn on ${alternate}.`);
      try {
        response = await client.messages.create(
          { model: alternate, max_tokens: maxTokens, system, messages, tools: TOOL_DEFINITIONS },
          { timeout: Math.max(1500, Math.min(REQUEST_TIMEOUT_MS, remainingAfterFailure - 300)) }
        );
        // Stay on the model that's actually answering for the rest of
        // this turn's tool loop instead of failing over again each pass.
        model = alternate;
      } catch (alternateErr) {
        if (!isCapacityOrTimeoutError(alternateErr)) throw alternateErr;
        throw new TransientAiError(
          `Anthropic unavailable on both ${model} and ${alternate}: ${alternateErr instanceof Error ? alternateErr.message : String(alternateErr)}`,
          alternateErr
        );
      }
    }

    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
    const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

    // Real usage logging — attributed to this specific business, so
    // per-business AI cost is actually knowable, since Anthropic's own
    // billing is one shared total across every HavnLine business.
    logAnthropicUsage(toolCtx.businessId, model, response.usage.input_tokens, response.usage.output_tokens);

    finalReply = textBlocks.map((b) => b.text).join(" ").trim();

    if (toolUseBlocks.length === 0) {
      break;
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUseBlocks) {
      const handler = TOOL_HANDLERS[toolUse.name];
      let result: unknown = { error: "Unknown tool" };
      if (handler) {
        try {
          result = await handler(toolUse.input, toolCtx);
        } catch (err) {
          result = { error: err instanceof Error ? err.message : "Tool execution failed" };
        }
      }
      toolCalls.push({ name: toolUse.name, input: toolUse.input, result });
      toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify(result) });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return { reply: finalReply || "I'm sorry, could you repeat that?", toolCalls };
}
