import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "./systemPrompt";
import { TOOL_DEFINITIONS, TOOL_HANDLERS, type ToolContext } from "./tools";
import type { BusinessContext } from "./context";
import { logAnthropicUsage } from "@/lib/usage/tracking";
import { TransientAiError, isTransientAiError } from "./errors";
import { formatOrderStateBlock, ORDER_PLACED_BLOCK, type CurrentOrder, type OrderSnapshot } from "./orderState";

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

export interface TurnStats {
  /** How many times the model was called this turn (tool use = more than one). */
  modelCalls: number;
  /** Total time spent waiting on the model, across all calls. */
  modelMs: number;
  /** Total time spent running tools (database, Stripe, texts). */
  toolMs: number;
  /** Prompt tokens read from / written to Anthropic's prompt cache. */
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Prompt tokens processed normally (not served from the cache). */
  inputTokens: number;
}

export interface RunTurnResult {
  reply: string;
  toolCalls: { name: string; input: unknown; result: unknown }[];
  stats?: TurnStats;
}

// The usage block, including the prompt-caching counters this SDK version's
// types predate.
interface UsageWithCache {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export async function runTurn(
  history: ConversationMessage[],
  userMessage: string,
  toolCtx: ToolContext,
  options: { maxTokens?: number; model?: string; currentOrder?: CurrentOrder } = {}
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

  const systemText = buildSystemPrompt(toolCtx.context, toolCtx.channel);

  // Prompt caching. The system prompt (rules + the whole menu) and the tool
  // definitions in front of it are the same on every turn of every call to
  // the same business, and a turn that uses a tool sends them to the model
  // again for its second pass. Marking the end of the system prompt as a
  // cache point lets Anthropic reuse the already-processed prefix instead of
  // reading it from scratch each time: faster first word and about a tenth
  // of the price for those tokens. The text only changes when something it
  // states changes (the date, open/closed, a time-based price, a promotion
  // starting or ending), and then the cache simply refreshes.
  //
  // This SDK version's types don't list `cache_control` yet, hence the cast;
  // the API accepts it. A prompt too short to be cached is processed
  // normally and nothing breaks — the cache_read / cache_write numbers in
  // the [timing] log lines show whether it is actually kicking in.
  // The live order goes in a second block AFTER the cache point, so it can
  // change on every turn without invalidating the cached prefix above it.
  // (Only the first block is marked; a cache hit covers everything up to it.)
  // Without an order (the options say nothing), no second block is sent.
  let orderBlockText = options.currentOrder ? formatOrderStateBlock(options.currentOrder) : null;
  const buildSystem = () =>
    [
      { type: "text", text: systemText, cache_control: { type: "ephemeral" } },
      ...(orderBlockText ? [{ type: "text", text: orderBlockText }] : []),
    ] as unknown as Anthropic.TextBlockParam[];
  let system = buildSystem();

  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  const toolCalls: { name: string; input: unknown; result: unknown }[] = [];
  let finalReply = "";
  const stats: TurnStats = { modelCalls: 0, modelMs: 0, toolMs: 0, cacheReadTokens: 0, cacheWriteTokens: 0, inputTokens: 0 };

  for (let iteration = 0; iteration < 5; iteration++) {
    // A phone turn that has already spent its time budget (a slow tool,
    // a slow first call) stops here rather than starting another model
    // call Twilio will abandon — see PHONE_TURN_BUDGET_MS.
    const remainingMs = PHONE_TURN_BUDGET_MS - (Date.now() - turnStartedAt);
    if (toolCtx.channel === "phone" && iteration > 0 && remainingMs < MIN_TIME_FOR_ANOTHER_ATTEMPT_MS) {
      break;
    }

    let response: Anthropic.Message;
    const modelCallStartedAt = Date.now();
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

    stats.modelCalls += 1;
    stats.modelMs += Date.now() - modelCallStartedAt;

    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
    const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

    // Real usage logging — attributed to this specific business, so
    // per-business AI cost is actually knowable, since Anthropic's own
    // billing is one shared total across every HavnLine business.
    // Cached tokens are billed differently from ordinary input (reads cost a
    // tenth, writes a quarter more), and the API reports them separately from
    // input_tokens. Fold them back into one input-equivalent figure so the
    // per-business cost estimate stays right.
    const usage = response.usage as UsageWithCache;
    const cacheRead = usage.cache_read_input_tokens || 0;
    const cacheWrite = usage.cache_creation_input_tokens || 0;
    stats.cacheReadTokens += cacheRead;
    stats.cacheWriteTokens += cacheWrite;
    stats.inputTokens += usage.input_tokens;
    logAnthropicUsage(
      toolCtx.businessId,
      model,
      Math.round(usage.input_tokens + cacheWrite * 1.25 + cacheRead * 0.1),
      usage.output_tokens
    );

    finalReply = textBlocks.map((b) => b.text).join(" ").trim();

    if (toolUseBlocks.length === 0) {
      break;
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    const toolsStartedAt = Date.now();
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

    stats.toolMs += Date.now() - toolsStartedAt;

    // If a tool changed the order, its result carries the updated order.
    // Refresh the CURRENT ORDER block to match, so the next pass never sees
    // the old order in the system prompt next to a newer one in the tool
    // result.
    if (options.currentOrder) {
      for (let i = toolCalls.length - 1; i >= 0; i--) {
        const call = toolCalls[i];
        const result = call.result as { current_order?: unknown; success?: unknown; order_id?: unknown } | null;
        if (call.name === "confirm_and_place_order" && result?.success === true && result.order_id) {
          orderBlockText = ORDER_PLACED_BLOCK;
          system = buildSystem();
          break;
        }
        const updated = result?.current_order;
        if (updated && typeof updated === "object" && Array.isArray((updated as OrderSnapshot).items)) {
          orderBlockText = formatOrderStateBlock({ status: "ok", order: updated as OrderSnapshot });
          system = buildSystem();
          break;
        }
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  return { reply: finalReply || "I'm sorry, could you repeat that?", toolCalls, stats };
}
