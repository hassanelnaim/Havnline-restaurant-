/**
 * What runTurn throws once it has exhausted its own recovery (primary
 * model, then the alternate model) and the cause was capacity or timing
 * rather than a bug. An explicit class because the Anthropic SDK's
 * errors don't reliably carry a distinguishing `.name`.
 */
export class TransientAiError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "TransientAiError";
  }
}

/**
 * Whether an AI-turn failure is the kind that goes away on its own —
 * the provider is rate-limiting or briefly overloaded, a request timed
 * out, a connection dropped — as opposed to a real bug (bad prompt, a
 * thrown exception in our own code) that will fail the same way again.
 *
 * Duck-typed on `status` / `name` rather than `instanceof` against the
 * Anthropic SDK's error classes so this stays a dependency-free helper
 * both the AI layer and the TwiML layer can import without dragging the
 * SDK (or each other) in.
 */
export function isTransientAiError(err: unknown): boolean {
  if (err instanceof TransientAiError) return true;
  if (typeof err !== "object" || err === null) return false;
  const e = err as { status?: unknown; name?: unknown; message?: unknown };

  if (typeof e.status === "number") {
    // 408 timeout, 409 conflict-retry, 429 rate limited, 5xx (incl.
    // Anthropic's 529 "overloaded").
    return e.status === 408 || e.status === 409 || e.status === 429 || e.status >= 500;
  }

  const name = typeof e.name === "string" ? e.name : "";
  const message = typeof e.message === "string" ? e.message.toLowerCase() : "";
  return (
    name.includes("Timeout") ||
    name.includes("Connection") ||
    name === "AbortError" ||
    message.includes("timed out") ||
    message.includes("fetch failed") ||
    message.includes("overloaded")
  );
}
