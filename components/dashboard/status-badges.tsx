import { Badge } from "@/components/ui/badge";

export function CallOutcomeBadge({ outcome }: { outcome: string }) {
  const map: Record<string, { label: string; variant: "brand" | "success" | "danger" | "neutral" }> = {
    order_placed: { label: "Order placed", variant: "success" },
    question_answered: { label: "Answered", variant: "brand" },
    escalated: { label: "Escalated", variant: "danger" },
    no_action: { label: "No action", variant: "neutral" },
    missed: { label: "Missed", variant: "danger" },
  };
  const entry = map[outcome] || { label: outcome, variant: "neutral" as const };
  return <Badge variant={entry.variant}>{entry.label}</Badge>;
}

export function OrderStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "brand" | "success" | "danger" | "neutral" }> = {
    building: { label: "Building", variant: "neutral" },
    confirmed: { label: "Confirmed (not sent)", variant: "brand" },
    submitted: { label: "Sent to kitchen", variant: "success" },
    failed: { label: "Failed to send", variant: "danger" },
    cancelled: { label: "Cancelled", variant: "danger" },
  };
  const entry = map[status] || { label: status, variant: "neutral" as const };
  return <Badge variant={entry.variant}>{entry.label}</Badge>;
}

export function IntegrationStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "brand" | "success" | "danger" | "neutral" }> = {
    connected: { label: "Connected", variant: "success" },
    not_connected: { label: "Not connected", variant: "neutral" },
    coming_soon: { label: "Coming soon", variant: "neutral" },
  };
  const entry = map[status] || { label: status, variant: "neutral" as const };
  return <Badge variant={entry.variant}>{entry.label}</Badge>;
}
