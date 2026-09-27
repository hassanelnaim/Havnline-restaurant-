import { fetchPendingOrders, ackOrder, PrintJob } from "./api";
import { printTicket } from "./printer";
import { POLL_INTERVAL_MS } from "../config";

export interface PollLogEntry {
  id: string;
  message: string;
  ok: boolean;
  at: string;
}

export interface Poller {
  stop: () => void;
}

/**
 * The whole app, really: poll for pending orders, print each one on
 * the configured printer, and report back whether it actually
 * printed. Runs on a plain interval rather than push notifications —
 * see config.ts for why that trade-off makes sense for a
 * plugged-in kitchen tablet.
 */
export function createPoller(opts: {
  deviceToken: string;
  getPrinterIp: () => string | null;
  onLog: (entry: PollLogEntry) => void;
}): Poller {
  let stopped = false;
  let inFlight = false;

  async function handleJob(job: PrintJob) {
    const printerIp = opts.getPrinterIp();
    if (!printerIp) {
      await ackOrder(opts.deviceToken, job.id, "failed", "No printer IP configured on this tablet yet.");
      opts.onLog({ id: job.id, message: "Order received, but no printer IP is set — add one below.", ok: false, at: new Date().toISOString() });
      return;
    }

    try {
      await printTicket(printerIp, job.ticket_text);
      await ackOrder(opts.deviceToken, job.id, "printed");
      opts.onLog({ id: job.id, message: "Order printed.", ok: true, at: new Date().toISOString() });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't print.";
      // Still ack as failed (rather than leaving it silently pending
      // forever) so the dashboard can eventually surface this instead
      // of an order just never showing up with no explanation.
      await ackOrder(opts.deviceToken, job.id, "failed", message);
      opts.onLog({ id: job.id, message: `Print failed: ${message}`, ok: false, at: new Date().toISOString() });
    }
  }

  async function tick() {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const result = await fetchPendingOrders(opts.deviceToken);
      if (!result.success) {
        opts.onLog({ id: `err-${Date.now()}`, message: result.error || "Couldn't reach HavnLine.", ok: false, at: new Date().toISOString() });
        return;
      }
      // Sequential, not parallel — two tickets hitting the same
      // printer connection at once is exactly the kind of thing that
      // produces garbled output on real thermal printers.
      for (const job of result.jobs || []) {
        await handleJob(job);
      }
    } catch (err) {
      opts.onLog({ id: `err-${Date.now()}`, message: err instanceof Error ? err.message : "Network error.", ok: false, at: new Date().toISOString() });
    } finally {
      inFlight = false;
    }
  }

  const interval = setInterval(tick, POLL_INTERVAL_MS);
  tick(); // don't make the tablet wait a full interval after opening the app

  return {
    stop() {
      stopped = true;
      clearInterval(interval);
    },
  };
}
