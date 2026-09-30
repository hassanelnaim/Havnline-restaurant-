import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "./systemPrompt";
import { TOOL_DEFINITIONS, TOOL_HANDLERS, type ToolContext } from "./tools";
import type { BusinessContext } from "./context";
import { logAnthropicUsage } from "@/lib/usage/tracking";

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const PHONE_MODEL = process.env.ANTHROPIC_PHONE_MODEL || "claude-haiku-4-5-20251001";

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

  const client = new Anthropic({ apiKey });
  const model = options.model || (toolCtx.channel === "phone" ? PHONE_MODEL : DEFAULT_MODEL);
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
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages,
      tools: TOOL_DEFINITIONS,
    });

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
