"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, Loader2, Mic, MessageSquare, Plus, Sliders, X } from "lucide-react";
import type { AiResponsibilities, DbAiReceptionist, DbAiVoiceConfig, DbBusinessHours, Personality } from "@/lib/database/types";
import { updateAiEmployeeAction } from "@/app/actions/business";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ElevenLabsVoiceBrowser } from "@/components/voice/elevenlabs-voice-browser";
import { cn } from "@/lib/utils";

const PERSONALITIES: { id: Personality; label: string; line: string }[] = [
  { id: "professional", label: "Professional", line: "Polished and efficient" },
  { id: "friendly", label: "Friendly", line: "Easygoing, like a regular" },
  { id: "warm", label: "Warm", line: "Caring and reassuring" },
  { id: "energetic", label: "Energetic", line: "Upbeat, extra pep" },
  { id: "calm", label: "Calm", line: "Steady, never rushed" },
];

const RESPONSIBILITY_ITEMS: { key: keyof AiResponsibilities; label: string; line: string }[] = [
  { key: "answer_questions", label: "Answer questions", line: "Hours, menu, prices, specials and anything in Knowledge." },
  { key: "take_orders", label: "Take phone orders", line: "Builds the order item by item and places it." },
  { key: "modify_orders", label: "Change items mid-call", line: "Add, remove or adjust items before the order is placed." },
  { key: "collect_customer_info", label: "Collect name and number", line: "Needed to place an order and text the payment link." },
  { key: "escalate_to_human", label: "Hand off to a person", line: "Rings you (or logs a callback) for refunds, complaints and anything unclear." },
];

const ORDERING_SUGGESTIONS = [
  "Pickup only — we don't deliver.",
  "Orders are ready in about 20 minutes.",
  "No substitutions on specials.",
  "Always offer a drink or a side before finishing the order.",
  "Large orders (over 10 items) need 45 minutes.",
];
const ESCALATION_SUGGESTIONS = [
  "Send catering requests to a person.",
  "Send orders over $200 to a person.",
  "Send any allergy question the menu doesn't answer to a person.",
  "If a caller asks for the owner by name, hand off.",
];

/** Things that won't work as switched, so the owner hears about it before a caller does. */
function responsibilityWarnings(r: AiResponsibilities): string[] {
  const w: string[] = [];
  if (r.take_orders && !r.collect_customer_info) w.push("Orders can't be placed without the caller's name and number — turn on “Collect name and number”.");
  if (r.modify_orders && !r.take_orders) w.push("“Change items mid-call” does nothing while taking orders is off.");
  if (!r.escalate_to_human) w.push("With hand-offs off, a caller who asks for a person can only be told to call back.");
  if (!r.answer_questions && !r.take_orders) w.push("With questions and orders both off, your AI can't help callers with anything.");
  return w;
}

function addLine(existing: string, line: string): string {
  if (existing.includes(line)) return existing;
  return existing.trim() ? `${existing.trim()}\n${line}` : line;
}

type Snapshot = { personality: Personality; responsibilities: AiResponsibilities; orderingRules: string; escalationRules: string; voiceRef: string | null };

export function AiEmployeeClient({ ai, voice }: { ai: DbAiReceptionist; voice: DbAiVoiceConfig; hours: DbBusinessHours[] }) {
  const [personality, setPersonality] = useState(ai.personality);
  const [responsibilities, setResponsibilities] = useState(ai.responsibilities);
  const [orderingRules, setOrderingRules] = useState(ai.ordering_rules || "");
  const [escalationRules, setEscalationRules] = useState(ai.escalation_rules || "");
  const [voiceId] = useState(voice.voice_id);
  const [customVoiceRef, setCustomVoiceRef] = useState<string | null>(voice.voice_id === "custom" ? voice.provider_voice_ref : null);
  const [customVoiceName, setCustomVoiceName] = useState<string | null>(voice.voice_id === "custom" ? voice.provider_voice_name : null);
  const [changingVoice, setChangingVoice] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // What was last saved, so the save bar only shows when something changed.
  const [baseline, setBaseline] = useState<Snapshot>({
    personality: ai.personality,
    responsibilities: ai.responsibilities,
    orderingRules: ai.ordering_rules || "",
    escalationRules: ai.escalation_rules || "",
    voiceRef: voice.voice_id === "custom" ? voice.provider_voice_ref : null,
  });
  const current: Snapshot = { personality, responsibilities, orderingRules, escalationRules, voiceRef: customVoiceRef };
  const dirty = JSON.stringify(current) !== JSON.stringify(baseline);
  const warnings = useMemo(() => responsibilityWarnings(responsibilities), [responsibilities]);
  const enabledCount = Object.values(responsibilities).filter(Boolean).length;

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await updateAiEmployeeAction({
        personality, responsibilities, voiceId: customVoiceRef ? "custom" : voiceId, orderingRules, escalationRules,
        customVoice: customVoiceRef && customVoiceName ? { providerVoiceRef: customVoiceRef, providerVoiceName: customVoiceName } : null,
      });
      if (!result.success) { setError(result.error || "Could not save changes."); return; }
      setBaseline(current);
      setChangingVoice(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    });
  }

  function discard() {
    setPersonality(baseline.personality);
    setResponsibilities(baseline.responsibilities);
    setOrderingRules(baseline.orderingRules);
    setEscalationRules(baseline.escalationRules);
    setCustomVoiceRef(baseline.voiceRef);
    if (baseline.voiceRef === (voice.voice_id === "custom" ? voice.provider_voice_ref : null)) setCustomVoiceName(voice.voice_id === "custom" ? voice.provider_voice_name : null);
    setError(null);
  }

  const toneLabel = PERSONALITIES.find((p) => p.id === personality)?.label ?? personality;

  return (
    <div className="pb-20">
      {/* At a glance */}
      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-brand/20 bg-gradient-to-br from-brand-50 to-brand-soft px-5 py-4">
        <div className="flex items-center gap-2 text-[13px]">
          <span className={cn("h-2 w-2 rounded-full", ai.status === "online" ? "bg-success" : "bg-text-faint")} />
          <span className="font-semibold text-ink">{ai.status === "online" ? "Answering calls" : "Offline"}</span>
        </div>
        <div className="text-[13px] text-text-muted"><Mic className="mr-1 inline h-3.5 w-3.5 text-brand" />Voice: <span className="font-semibold text-ink">{customVoiceName?.split(" - ")[0] || "Default"}</span></div>
        <div className="text-[13px] text-text-muted">Tone: <span className="font-semibold text-ink">{toneLabel}</span></div>
        <div className="text-[13px] text-text-muted"><Sliders className="mr-1 inline h-3.5 w-3.5 text-brand" />{enabledCount} of {RESPONSIBILITY_ITEMS.length} jobs on</div>
        <Link href="/dashboard/test-receptionist" className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-medium text-white shadow-sm hover:bg-brand-dark">
          <MessageSquare className="h-3.5 w-3.5" /> Try it <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <Tabs defaultValue="voice">
        <TabsList>
          <TabsTrigger value="voice"><Mic className="h-3.5 w-3.5" /> Voice &amp; tone</TabsTrigger>
          <TabsTrigger value="behavior"><Sliders className="h-3.5 w-3.5" /> Business behavior</TabsTrigger>
        </TabsList>

        <TabsContent value="voice">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Voice</CardTitle>
                <CardDescription className="mt-1">What callers hear. It never gives itself a name — it answers as your restaurant&apos;s automated order-taker.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand/30 bg-brand-50 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-white"><Mic className="h-5 w-5" /></span>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-dark">Current voice</div>
                      <div className="text-[14px] font-semibold text-ink">{customVoiceName || "Default voice"}</div>
                    </div>
                  </div>
                  <Button variant={changingVoice ? "outline" : "brand"} size="sm" onClick={() => setChangingVoice((v) => !v)}>
                    {changingVoice ? <><X className="h-3.5 w-3.5" /> Done</> : "Change voice"}
                  </Button>
                </div>
                {changingVoice && (
                  <ElevenLabsVoiceBrowser selectedVoiceRef={customVoiceRef} onSelect={(id, name) => { setCustomVoiceRef(id); setCustomVoiceName(name); }} />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Tone</CardTitle><CardDescription className="mt-1">How it talks on every call.</CardDescription></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {PERSONALITIES.map((p) => (
                    <button key={p.id} onClick={() => setPersonality(p.id)} className={cn("rounded-xl border px-3 py-3 text-left transition-colors", personality === p.id ? "border-brand bg-brand-soft ring-1 ring-brand" : "border-border bg-card hover:bg-paper")}>
                      <span className={cn("block text-[13.5px] font-semibold", personality === p.id ? "text-brand-dark" : "text-ink")}>{p.label}</span>
                      <span className="mt-0.5 block text-[11.5px] text-text-muted">{p.line}</span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="behavior">
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle>What it&apos;s allowed to do</CardTitle><CardDescription className="mt-1">Turn a job off and your AI won&apos;t attempt it.</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                <div className="divide-y divide-border-soft">
                  {RESPONSIBILITY_ITEMS.map((item) => (
                    <label key={item.key} className="flex cursor-pointer items-center justify-between gap-4 py-3">
                      <span>
                        <span className="block text-[13.5px] font-semibold text-ink">{item.label}</span>
                        <span className="mt-0.5 block text-[12px] text-text-muted">{item.line}</span>
                      </span>
                      <Switch checked={responsibilities[item.key]} onCheckedChange={(checked) => setResponsibilities((prev) => ({ ...prev, [item.key]: checked }))} />
                    </label>
                  ))}
                </div>
                {warnings.map((w) => (
                  <div key={w} className="flex items-start gap-2 rounded-lg border border-yellow-300/60 bg-yellow-50 px-3.5 py-2.5 text-[12.5px] text-yellow-900">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>House rules</CardTitle><CardDescription className="mt-1">Anything specific to your restaurant, in plain English. Tap a suggestion to add it.</CardDescription></CardHeader>
              <CardContent className="space-y-5">
                {([
                  { label: "Ordering rules", value: orderingRules, set: setOrderingRules, suggestions: ORDERING_SUGGESTIONS, placeholder: "e.g. Pickup only. Orders are ready in about 20 minutes." },
                  { label: "When to hand off to a person", value: escalationRules, set: setEscalationRules, suggestions: ESCALATION_SUGGESTIONS, placeholder: "e.g. Send catering requests and orders over $200 to a person." },
                ] as const).map((f) => (
                  <div key={f.label}>
                    <Label>{f.label}</Label>
                    <Textarea rows={3} className="mt-1.5" value={f.value} onChange={(e) => f.set(e.target.value)} placeholder={f.placeholder} />
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {f.suggestions.filter((sug) => !f.value.includes(sug)).map((sug) => (
                        <button key={sug} onClick={() => f.set(addLine(f.value, sug))} className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-0.5 text-[12px] text-text-muted hover:border-brand/40 hover:bg-brand-50 hover:text-brand-dark">
                          <Plus className="h-3 w-3" /> {sug}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* One save bar for everything; only when something changed. */}
      <div className={cn("fixed inset-x-0 bottom-0 z-30 transition-transform duration-300 lg:left-64", dirty || saved || error ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-full opacity-0")}>
        <div className="mx-auto mb-4 flex max-w-3xl items-center gap-3 rounded-2xl border border-border bg-ink px-4 py-3 text-white shadow-popover">
          {saved && !dirty ? (
            <span className="flex items-center gap-2 text-[13px] font-medium"><Check className="h-4 w-4 text-success" /> Saved. Your AI uses this on the next call.</span>
          ) : (
            <>
              <span className="flex-1 text-[13px]">{error ? <span className="text-red-300">{error}</span> : "You have unsaved changes"}</span>
              <button onClick={discard} disabled={isPending} className="rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-white/75 hover:text-white">Discard</button>
              <Button variant="brand" size="sm" onClick={handleSave} disabled={isPending}>{isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : "Save changes"}</Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
