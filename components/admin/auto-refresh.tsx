"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Silently re-fetches this server-rendered page on an interval while
 * it's open, so admin numbers (MRR, issues, business list) stay current
 * without a manual reload — the actual "keep this consistently
 * updating" fix is that these numbers are now computed from real data
 * on every render (see lib/billing/platform-metrics.ts,
 * lib/admin/issues.ts) instead of a hardcoded guess; this just means
 * you don't have to hit refresh yourself to see it move. Pauses while
 * the tab isn't visible so it's not silently hammering Stripe/Supabase
 * in a background tab.
 */
export function AutoRefresh({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        routerRef.current.refresh();
      }
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return null;
}
