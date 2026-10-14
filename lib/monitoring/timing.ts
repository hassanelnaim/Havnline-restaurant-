/**
 * Tiny per-request stopwatch for the live-call path.
 *
 * Every phone webhook (voice, gather, process, gather-continue) makes one
 * timer, marks the end of each stage, and writes ONE log line when it
 * finishes, e.g.
 *
 *   [timing] gather call=1a2b3c4d total=2310ms lookup=64 auth_voice=71 model=1480 tools=420 ...
 *
 * so that "the call feels slow" can be answered from the Vercel logs with a
 * number per stage instead of a guess. Search the logs for `[timing]`.
 *
 * Only durations and short ids are logged — never what the caller said, a
 * phone number, a name, or anything from the order.
 *
 * Set TIMING_LOGS=off to silence it.
 */

export type TimingField = string | number | boolean | null | undefined;

export interface Timer {
  /** Adds the time since the previous mark (or the start) to `stage`. */
  mark(stage: string): void;
  /** Adds a duration measured elsewhere (e.g. summed across tool-loop passes). */
  add(stage: string, ms: number): void;
  /** Attaches a small non-secret value (a count, a flag) to the log line. */
  set(key: string, value: TimingField): void;
  /** Milliseconds since the timer started. */
  elapsed(): number;
  /** Writes the log line. Safe to call more than once; only the first counts. */
  done(): void;
}

export function createTimer(label: string, fields: Record<string, TimingField> = {}): Timer {
  const startedAt = Date.now();
  let lastMarkAt = startedAt;
  const stages = new Map<string, number>();
  const extras = new Map<string, TimingField>(Object.entries(fields));
  let finished = false;

  return {
    mark(stage) {
      const now = Date.now();
      stages.set(stage, (stages.get(stage) || 0) + (now - lastMarkAt));
      lastMarkAt = now;
    },
    add(stage, ms) {
      stages.set(stage, (stages.get(stage) || 0) + Math.max(0, Math.round(ms)));
    },
    set(key, value) {
      extras.set(key, value);
    },
    elapsed() {
      return Date.now() - startedAt;
    },
    done() {
      if (finished) return;
      finished = true;
      if (process.env.TIMING_LOGS === "off") return;
      const parts = [`[timing] ${label}`];
      for (const [key, value] of extras) {
        if (value !== undefined && value !== null) parts.push(`${key}=${value}`);
      }
      parts.push(`total=${Date.now() - startedAt}ms`);
      for (const [stage, ms] of stages) parts.push(`${stage}=${ms}`);
      console.log(parts.join(" "));
    },
  };
}

/** First 8 characters of an id: enough to tell calls apart in the logs. */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "none";
}
