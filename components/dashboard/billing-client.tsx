"use client";
import { useState } from "react";
import { startCheckoutAction, openBillingPortalAction } from "@/app/actions/billing";
import type { DbBusiness } from "@/lib/database/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const STATUS_META: Record<string, { label: string; variant: "brand" | "success" | "danger" | "neutral"; description: string }> = {
  none: { label: "Not subscribed", variant: "neutral", description: "Start your 7-day free trial — no charge until it ends." },
  trialing: { label: "Free trial", variant: "brand", description: "You're in your free trial — no charge until it ends." },
  active: { label: "Active", variant: "success", description: "Your subscription is active." },
  past_due: { label: "Past due", variant: "danger", description: "Your last payment failed — update your payment method." },
  canceled: { label: "Canceled", variant: "neutral", description: "Your subscription has ended." },
};

export function BillingClient({ business }: { business: DbBusiness }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = STATUS_META[business.subscription_status] || STATUS_META.none;
  const hasSubscription = business.subscription_status !== "none" && business.subscription_status !== "canceled";

  async function handleSubscribe() {
    setLoading(true);
    setError(null);
    const result = await startCheckoutAction();
    if (result.url) { window.location.href = result.url; return; }
    setLoading(false);
    setError(result.error || "Could not start checkout.");
  }

  async function handleManage() {
    setLoading(true);
    setError(null);
    const result = await openBillingPortalAction();
    if (result.url) { window.location.href = result.url; return; }
    setLoading(false);
    setError(result.error || "Could not open billing portal.");
  }

  return (
    <Card>
      <CardHeader><CardTitle>Subscription</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2"><Badge variant={status.variant}>{status.label}</Badge></div>
        <p className="text-[13.5px] text-text-muted">{status.description}</p>
        {error && <div className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{error}</div>}
        <div className="flex gap-3 pt-2">
          {hasSubscription ? (
            <Button variant="outline" onClick={handleManage} disabled={loading}>{loading ? "Opening…" : "Manage billing"}</Button>
          ) : (
            <Button variant="brand" onClick={handleSubscribe} disabled={loading}>{loading ? "Starting checkout…" : "Start 7-day free trial"}</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
