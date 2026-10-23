import { NextRequest, NextResponse } from "next/server";
import { hasValidCallKey } from "@/lib/ai/callUrlKey";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBusinessTwilioAuthToken } from "@/lib/ai/context";
import { validateTwilioSignature } from "@/lib/integrations/telephony/twilioProvider";
import { getRequestUrl } from "@/lib/ai/twimlHelpers";
import { sendOrderAttentionEmail } from "@/lib/notifications/account-email";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/webhooks/twilio/sms-status?orderId=...
 *
 * Twilio's delivery report for a payment-link text. Twilio ACCEPTING a
 * text isn't delivery: a carrier can reject it a few seconds later (an
 * unregistered A2P sender, a landline, a blocked number), and the customer
 * then never gets the link, never pays, and the order never reaches the
 * kitchen. On a failure this records it on the order (the AI tells a
 * caller still on the line on its next turn, see orderState.ts) and emails
 * the restaurant once, so someone can call the customer back.
 *
 * Reports can arrive out of order ("sent" after "delivered"), so a status
 * only ever moves forward.
 */
const RANK: Record<string, number> = { sending: 0, queued: 1, accepted: 1, sent: 2, delivered: 3, undelivered: 4, failed: 4 };

export async function POST(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get("orderId");
  if (!orderId) return new NextResponse("Missing orderId", { status: 400 });
  if (!hasValidCallKey(request.nextUrl, orderId)) return new NextResponse("Invalid link", { status: 403 });

  const formData = await request.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => (params[key] = String(value)));

  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("id, business_id, payment_status, payment_link_sms_status, customer_name, phone, total_cents")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return new NextResponse("OK");

  const authToken = await getBusinessTwilioAuthToken(order.business_id);
  if (!validateTwilioSignature(request.headers.get("x-twilio-signature"), getRequestUrl(request), params, authToken)) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const status = (params.MessageStatus || "").toLowerCase();
  if (!(status in RANK)) return new NextResponse("OK");
  const previous = order.payment_link_sms_status || "sending";
  if ((RANK[previous] ?? 0) >= RANK[status]) return new NextResponse("OK");

  const failed = status === "undelivered" || status === "failed";
  const errorText = failed ? `Twilio error ${params.ErrorCode || "unknown"}${params.ErrorMessage ? `: ${params.ErrorMessage}` : ""}`.slice(0, 300) : null;

  const { data: updated } = await admin
    .from("orders")
    .update({ payment_link_sms_status: status, ...(failed ? { payment_link_sms_error: errorText } : {}) })
    .eq("id", orderId)
    .eq("payment_link_sms_status", previous)
    .select("id")
    .maybeSingle();

  // Only the report that actually recorded the failure emails the owner,
  // and only while the order is still unpaid.
  if (updated && failed && order.payment_status === "awaiting_payment") {
    await sendOrderAttentionEmail({
      businessId: order.business_id,
      subject: "a customer didn't get their payment link",
      heading: "A payment link text didn't arrive",
      intro: `The text with the payment link for this phone order couldn't be delivered (${errorText}), so the customer can't pay and the order won't reach the kitchen. Call them back to sort it out.`,
      customerName: order.customer_name,
      customerPhone: order.phone,
      totalCents: order.total_cents,
    });
  }

  return new NextResponse("OK");
}
