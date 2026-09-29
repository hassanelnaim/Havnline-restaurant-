import { NextRequest, NextResponse } from "next/server";
import { sendWeeklyDigestEmails } from "@/lib/notifications/weekly-digest-email";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/weekly-digest
 *
 * Fired weekly by Vercel Cron (see vercel.json). Vercel automatically
 * sends `Authorization: Bearer ${CRON_SECRET}` on cron-triggered
 * requests when a CRON_SECRET env var is set on the project — checked
 * here so this endpoint can't be hit by anyone who finds the URL and
 * used to spam every business's members with a digest email on demand.
 * If CRON_SECRET isn't set, the check is skipped (matches this app's
 * existing pattern of every integration quietly no-op'ing/staying open
 * rather than throwing when optional config is missing) — set it in
 * production.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
  }

  const result = await sendWeeklyDigestEmails();
  return NextResponse.json(result);
}
