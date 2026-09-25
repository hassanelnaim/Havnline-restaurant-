"use client";
import { useState, useTransition } from "react";
import { toggleAiStatusAction } from "@/app/actions/business";
import { Switch } from "@/components/ui/switch";

export function AiStatusToggle({ initialStatus, tone = "dark" }: { initialStatus: "online" | "offline"; tone?: "dark" | "light" }) {
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

  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${online ? "bg-success animate-pulse-ring" : tone === "light" ? "bg-[#5B6472]" : "bg-text-faint"}`} />
      <span className={`text-[13px] font-medium ${tone === "light" ? "text-white" : "text-text"}`}>{online ? "Online" : "Offline"}</span>
      <Switch checked={online} onCheckedChange={handleToggle} />
      {error && <span className="ml-2 text-[11.5px] text-danger">{error}</span>}
    </div>
  );
}
