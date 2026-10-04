import TcpSocket from "react-native-tcp-socket";
import { PRINTER_PORT } from "../config";

// Raw ESC/POS over a plain TCP socket on port 9100 — the standard
// almost every network-connected receipt/kitchen printer (Epson, Star
// Micronics, generic ESC/POS clones) speaks, and the same category of
// connection the restaurant's existing POS already uses to print to
// this same printer. No printer-specific SDK needed.
const ESC = "\x1b";
const GS = "\x1d";

function buildEscPosPayload(ticketText: string): string {
  const init = `${ESC}@`; // ESC @ — reset the printer to a known state
  const body = ticketText.replace(/\n/g, "\r\n");
  const feedAndCut = "\n\n\n" + `${GS}V\x00`; // feed a few lines, then GS V 0 — full cut
  return init + body + feedAndCut;
}

// react-native-tcp-socket's "error" event (and a write callback's err)
// crosses the native-bridge boundary, and what actually lands in JS
// isn't reliably a real Error instance with a usable .message — it can
// be a plain { code, message } object, a bare string, or something
// else entirely depending on platform/version. Every caller downstream
// (this screen's test print, the print-job poller) does
// `err instanceof Error ? err.message : "<generic>"`, so whenever the
// rejected value fails that check, the real reason is silently
// replaced with a useless generic message — exactly what happened when
// a test print failed with no detail at all. Normalizing to a real
// Error here, with the best message we can pull out of whatever shape
// came in, means every one of those existing `instanceof Error` checks
// downstream actually succeeds and shows something diagnosable.
function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === "string") return new Error(err);
  if (err && typeof err === "object") {
    const anyErr = err as Record<string, unknown>;
    const message = (typeof anyErr.message === "string" && anyErr.message) || (typeof anyErr.code === "string" && anyErr.code);
    return new Error(message || JSON.stringify(err));
  }
  return new Error("Unknown printer error.");
}

/**
 * Opens a connection to the printer, sends one ticket, and closes it —
 * one job per connection rather than holding it open, since jobs
 * arrive seconds apart at most and a held-open socket is one more
 * thing that can silently go stale between orders.
 */
export function printTicket(printerIp: string, ticketText: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      try {
        socket.destroy();
      } catch {
        // already gone — nothing to clean up
      }
      reject(toError(err));
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      resolve();
    };

    // Belt-and-suspenders: a printer that accepts the TCP connection
    // but never actually responds (powered off but still on the
    // network, wrong device entirely) would otherwise hang a poll
    // cycle forever. 8s comfortably covers a real print + cut.
    const hardTimeout = setTimeout(() => fail(new Error("Timed out waiting for the printer to respond.")), 8000);

    const socket = TcpSocket.createConnection({ port: PRINTER_PORT, host: printerIp, connectTimeout: 5000 }, () => {
      socket.write(buildEscPosPayload(ticketText), "ascii", (err?: unknown) => {
        if (err) {
          fail(err);
          return;
        }
        // Give the printer a moment to actually consume the bytes
        // before tearing the connection down.
        setTimeout(() => socket.destroy(), 300);
      });
    });

    socket.on("error", (err: unknown) => fail(err));
    socket.on("close", () => succeed());
  });
}
