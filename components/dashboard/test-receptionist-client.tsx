"use client";
import { useState, useRef, useEffect } from "react";
import { Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

interface Message { role: "user" | "assistant"; content: string; }

export function TestReceptionistClient() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [callId, setCallId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function sendMessage() {
    if (!input.trim() || loading) return;
    const userMsg = input;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg, callId }),
      });
      const data = await res.json();
      if (data.callId) setCallId(data.callId);
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply || "Sorry, something went wrong." }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Sorry, something went wrong." }]);
    }
    setLoading(false);
  }

  return (
    <Card className="flex h-[600px] flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-5">
        {messages.length === 0 && <p className="text-center text-[13px] text-text-faint">Say hello to start a test conversation.</p>}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "ml-auto max-w-[80%] rounded-xl rounded-br-sm bg-ink px-3.5 py-2.5 text-[13px] text-white" : "max-w-[85%] rounded-xl rounded-bl-sm border border-border-soft bg-paper px-3.5 py-2.5 text-[13px] text-text"}>
            {m.content}
          </div>
        ))}
        {loading && <div className="flex items-center gap-2 text-[12px] text-text-faint"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…</div>}
        <div ref={bottomRef} />
      </div>
      <div className="flex items-center gap-2 border-t border-border p-4">
        <Input placeholder="Type a message…" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendMessage()} />
        <Button variant="brand" size="icon" onClick={sendMessage} disabled={loading} aria-label="Send message"><Send className="h-4 w-4" /></Button>
      </div>
    </Card>
  );
}
