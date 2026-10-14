import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Everything except static assets and the machine-to-machine endpoints.
  // The webhooks (Twilio, Stripe, ...) and the TTS audio route are called by
  // services, never by a logged-in browser, so refreshing a login session
  // for them does nothing — it only adds a hop in front of every phone-call
  // webhook, where each millisecond is a caller waiting in silence.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/webhooks/|api/tts|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
