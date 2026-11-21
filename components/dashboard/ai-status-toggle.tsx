"use client";
import { useState, useTransition } from "react";
import { toggleAiStatusAction } from "@/app/actions/business";
import { Switch } from "@/components/ui/switch";

export function AiStatusToggle({ initialStatus, pausedUntil = null, tone = "dark" }: { initialStatus: "online" | "offline"; pausedUntil?: string | null; tone?: "dark" | "light" }) {
  const [online, setOnline] = useState(initialStatus === "online");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleToggle(checked: boolean) {
    setOnline(checked);
    setError(null);
    startTransition(async () => {
      const result = await toggleAiStatusAction(checked);
      if (!result.success) {
        setOnline(!checked);
        setError(result.error || "Could not update status.");
      }
    });
  }

  // Paused by HavnLine for an update: shown locked, so nobody flips it
  // expecting the AI to answer. Their own on/off choice is kept for after.
  if (pausedUntil !== null) {
    const until = pausedUntil ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(pausedUntil)) : null;
    return (
      <div className="flex items-center gap-2" title={`Paused by HavnLine for an update${until ? ` until ${until}` : ""}. It turns back on by itself.`}>
        <span className="h-2 w-2 rounded-full bg-danger" />
        <span className={`text-[13px] font-medium ${tone === "light" ? "text-white" : "text-text"}`}>Paused{until ? ` until ${until}` : " for update"}</span>
        <Switch checked={false} disabled aria-label={`AI order-taker paused by HavnLine for an update${until ? ` until ${until}` : ""}`} />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${online ? "bg-success animate-pulse-ring" : tone === "light" ? "bg-[#5B6472]" : "bg-text-faint"}`} />
      <span className={`text-[13px] font-medium ${tone === "light" ? "text-white" : "text-text"}`}>{online ? "Online" : "Offline"}</span>
      <Switch checked={online} onCheckedChange={handleToggle} aria-label={online ? "AI order-taker is on. Turn it off" : "AI order-taker is off. Turn it on"} />
      {error && <span className="ml-2 text-[11.5px] text-danger">{error}</span>}
    </div>
  );
}
