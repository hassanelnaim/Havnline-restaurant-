"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Megaphone } from "lucide-react";
import { markPlatformMessageReadAction } from "@/app/actions/platform-messages";
import type { DashboardMessage } from "@/lib/data/platform-messages";

/** Messages from HavnLine, shown at the top of every dashboard page until someone marks them read. */
export function PlatformMessages({ messages }: { messages: DashboardMessage[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [hidden, setHidden] = useState<string[]>([]);
  const visible = messages.filter((m) => !hidden.includes(m.id));
  if (visible.length === 0) return null;

  function markRead(id: string) {
    setHidden((h) => [...h, id]);
    startTransition(async () => {
      const r = await markPlatformMessageReadAction(id);
      if (!r.success) setHidden((h) => h.filter((x) => x !== id));
      else router.refresh();
    });
  }

  return (
    <section aria-label="Messages from HavnLine" className="mb-6 flex flex-col gap-3">
      {visible.map((m) => (
        <div key={m.id} className="rounded-2xl border border-brand/20 bg-brand-50 p-4">
          <div className="flex items-start gap-3">
            <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <h2 className="text-[14px] font-semibold text-ink">{m.subject}</h2>
                <span className="text-[11.5px] text-text-faint">
                  From HavnLine · {new Date(m.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-text-muted">{m.body}</p>
              <button type="button" onClick={() => markRead(m.id)} className="mt-2 text-[12.5px] font-medium text-brand hover:underline">
                Mark as read
              </button>
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}
