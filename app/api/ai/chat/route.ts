import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { startTestSession, handleTurn } from "@/lib/ai/receptionist";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { createAdminClient } from "@/lib/supabase/admin";

// Generous for genuine back-and-forth testing (a real conversation
// rarely runs past a few dozen turns), but bounded — this is real,
// billed Anthropic API usage per message with no other cap, so a
// script looping this endpoint could otherwise run up real cost on
// any authenticated account.
const MAX_MESSAGE_LENGTH = 2000;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const businessId = await getCurrentBusinessId();
  if (!businessId) return NextResponse.json({ error: "No business found." }, { status: 400 });

  const withinLimit = await checkRateLimit(`ai_chat:${businessId}`, 60, 10);
  if (!withinLimit) {
    return NextResponse.json({ error: "You're sending messages too quickly — please slow down." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const message = body?.message;
  const existingCallId = typeof body?.callId === "string" ? body.callId : null;
  if (!message || typeof message !== "string") return NextResponse.json({ error: "Missing message." }, { status: 400 });
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: "Message is too long." }, { status: 400 });
  }

  // The call id comes from the browser, so it must be one of THIS
  // restaurant's own test sessions. Otherwise any id would feed another
  // restaurant's real call transcript to this AI, write into that call, and
  // let the order tools change that call's live order.
  let callId = existingCallId;
  if (callId) {
    const admin = createAdminClient();
    const { data: session } = await admin.from("calls").select("id").eq("id", callId).eq("business_id", businessId).eq("phone", "test").maybeSingle();
    if (!session) callId = null;
  }
  if (!callId) {
    callId = await startTestSession(businessId);
  }

  try {
    const result = await handleTurn(businessId, callId, message, "test");
    return NextResponse.json({ reply: result.reply, callId });
  } catch (err) {
    console.error("Test chat turn failed:", err);
    return NextResponse.json({ error: "The AI ran into a problem — please try again.", callId }, { status: 502 });
  }
}
