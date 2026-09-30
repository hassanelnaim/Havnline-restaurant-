import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { startTestSession, handleTurn } from "@/lib/ai/receptionist";
import { checkRateLimit } from "@/lib/security/rateLimit";

// Generous for genuine back-and-forth testing (a real conversation
// rarely runs past a few dozen turns), but bounded — this is real,
// billed Anthropic API usage per message with no other cap, so a
// script looping this endpoint could otherwise run up real cost on
// any authenticated account.
const MAX_MESSAGE_LENGTH = 2000;

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const businessId = await getCurrentBusinessId();
  if (!businessId) return NextResponse.json({ error: "No business found." }, { status: 400 });

  const withinLimit = await checkRateLimit(`ai_chat:${businessId}`, 60, 10);
  if (!withinLimit) {
    return NextResponse.json({ error: "You're sending messages too quickly — please slow down." }, { status: 429 });
  }

  const { message, callId: existingCallId } = await request.json();
  if (!message) return NextResponse.json({ error: "Missing message." }, { status: 400 });
  if (typeof message !== "string" || message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: "Message is too long." }, { status: 400 });
  }

  let callId = existingCallId;
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
