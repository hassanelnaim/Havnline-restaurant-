import { NextRequest, NextResponse } from "next/server";
import { authenticateDevice } from "@/lib/integrations/printer-app";
import { verifyMoneyPin } from "@/lib/security/moneyPin";
import { signMoneyActionToken } from "@/lib/security/moneyActionToken";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { sendMoneyPinLockoutEmail } from "@/lib/notifications/pin-lockout-email";

export const dynamic = "force-dynamic";

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

/**
 * POST /api/printer-app/verify-pin
 *
 * The tablet calls this right before a refund or discount (added in a
 * later phase) — never for item edits/comps, which need no PIN at
 * all. On a correct PIN, returns a short-lived signed token (see
 * lib/security/moneyActionToken.ts) the tablet then sends along with
 * the actual money-moving request; the token proves the PIN was
 * checked without the tablet having to hold the PIN itself or re-ask
 * for it on every tap within the unlock window.
 *
 * Rate-limited per device AND per business — mirroring the dual
 * per-IP/global limiter in app/api/printer-app/pair/route.ts, with
 * deviceId standing in for IP since the caller is already
 * device-token authenticated by the time this runs. Every call to
 * checkRateLimit counts as one attempt regardless of whether the PIN
 * turns out right or wrong (same semantics as the pairing endpoint) —
 * simpler than tracking failures separately, and the threshold here
 * is set generously enough (8 per 15 min per device) that a cashier
 * doing several real refunds in a shift won't hit it, while a script
 * guessing blind still needs days to exhaust all 10,000 combinations.
 */
export async function POST(request: NextRequest) {
  const device = await authenticateDevice(bearerToken(request));
  if (!device) return NextResponse.json({ success: false, error: "Not paired." }, { status: 401 });

  const [deviceOk, businessOk] = await Promise.all([
    checkRateLimit(`money_pin_device:${device.deviceId}`, 8, 15),
    checkRateLimit(`money_pin_business:${device.businessId}`, 15, 15),
  ]);
  if (!deviceOk || !businessOk) {
    // Deduped separately so a sustained attempt sends roughly one
    // email per 15-minute window instead of one per rejected request.
    const shouldEmail = await checkRateLimit(`money_pin_lockout_email:${device.businessId}`, 1, 15);
    if (shouldEmail) await sendMoneyPinLockoutEmail(device.businessId);
    return NextResponse.json({ success: false, error: "Too many attempts. Please wait a few minutes and try again." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const pin = typeof body?.pin === "string" ? body.pin.trim() : "";

  const result = await verifyMoneyPin(device.businessId, pin);
  if (!result.valid) return NextResponse.json({ success: false, error: result.reason || "Incorrect PIN." }, { status: 401 });

  const { token, expiresAt } = signMoneyActionToken({ businessId: device.businessId, deviceId: device.deviceId });
  return NextResponse.json({ success: true, token, expiresAt });
}
